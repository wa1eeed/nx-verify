import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant, withoutTenant } from '../../packages/db/src/client.js';
import { verify } from '../../packages/core/src/verification/verify.js';
import {
  buildEvidenceContent,
  resolvePublicEvidence,
  sealEvidence,
} from '../../packages/core/src/evidence/evidence.js';
import { buildEvidenceDocument } from '../../packages/core/src/evidence/document.js';
import { renderEvidenceHtml } from '../../packages/core/src/evidence/render.js';
import { isSandbox } from '../../packages/core/src/tenants/sandbox.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../helpers/db.js';
import { preparePricedTenant, providerFixture } from '../helpers/billing.js';

/**
 * Guard 09: a test verification is never mistaken for a real one.
 *
 * A sandbox is a workspace rather than a flag (ADR-068), so the isolation this guard
 * checks is the same row level security everything else relies on. What it adds is the
 * part that leaves the platform: a document sealed in a sandbox has to say so on its face
 * and on the public page, because the person holding it has no account here and no other
 * way to find out.
 */

describe('guard 09: the sandbox is a different world', () => {
  let db: TestDatabase;
  let live: SeededTenant;
  let sandbox: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    live = await seedTenant(db.appPool, 'Real Workspace');
    sandbox = await seedTenant(db.appPool, 'Real Workspace (Sandbox)');

    await preparePricedTenant(db, live.tenantId);
    await preparePricedTenant(db, sandbox.tenantId, { packageCode: 'SANDBOX' });

    // Linked by the operator, because a workspace must not be able to declare itself one.
    await db.operatorPool.query('UPDATE tenants SET sandbox_of = $2 WHERE id = $1', [
      sandbox.tenantId,
      live.tenantId,
    ]);
  });

  afterAll(async () => {
    await db.close();
  });

  const run = (tenantId: string, unn: string) =>
    withTenant(db.appPool, tenantId, (tx) =>
      verify(tx, {
        productCode: 'ADDRESS_ONLY',
        subject: { unn },
        subjectIdentifiers: [{ idType: 'UNN', value: unn }],
        idempotencyKey: randomUUID(),
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

  it('knows which world it is in', async () => {
    expect(await withTenant(db.appPool, sandbox.tenantId, (tx) => isSandbox(tx))).toBe(true);
    expect(await withTenant(db.appPool, live.tenantId, (tx) => isSandbox(tx))).toBe(false);
  });

  it('refuses to nest one sandbox inside another', async () => {
    const deeper = await seedTenant(db.appPool, 'Deeper');
    await expect(
      db.operatorPool.query('UPDATE tenants SET sandbox_of = $2 WHERE id = $1', [
        deeper.tenantId,
        sandbox.tenantId,
      ]),
    ).rejects.toThrow(/cannot own another sandbox/);
  });

  it('keeps a test verification out of the real workspace entirely', async () => {
    const countIn = (tenantId: string, table: 'verification_runs' | 'entities' | 'attestations') =>
      withTenant(db.appPool, tenantId, async (tx) => {
        const { rows } = await tx.query<{ count: string }>(`SELECT count(*)::text FROM ${table}`);
        return Number(rows[0]?.count ?? '0');
      });

    const before = {
      runs: await countIn(live.tenantId, 'verification_runs'),
      entities: await countIn(live.tenantId, 'entities'),
      attestations: await countIn(live.tenantId, 'attestations'),
    };

    await run(sandbox.tenantId, '7001272184');

    // Nothing moved in the real workspace. Not filtered out by a WHERE somebody
    // remembered to write: unreachable, because it is not in this workspace.
    expect(await countIn(live.tenantId, 'verification_runs')).toBe(before.runs);
    expect(await countIn(live.tenantId, 'entities')).toBe(before.entities);
    expect(await countIn(live.tenantId, 'attestations')).toBe(before.attestations);

    // And it did happen, in the other one.
    expect(await countIn(sandbox.tenantId, 'verification_runs')).toBeGreaterThan(0);
  });

  it('stamps a sandbox document on its face', async () => {
    const result = await run(sandbox.tenantId, '7001272184');

    const html = await withTenant(db.appPool, sandbox.tenantId, async (tx) => {
      const content = await buildEvidenceContent(tx, result.runId);
      const sealed = await sealEvidence(tx, {
        runId: result.runId,
        content,
        storageKey: `evidence/${sandbox.tenantId}/${result.runId}.html`,
        signingKey: await keys.signingKey(sandbox.tenantId),
      });
      const document = await buildEvidenceDocument(tx, {
        content,
        contentHash: sealed.contentHash,
        publicToken: sealed.publicToken,
        verifyBaseUrl: 'https://verify.nx.sa',
      });
      expect(document.header.sandbox).toBe(true);
      return renderEvidenceHtml(document);
    });

    expect(html).toContain('data-role="sandbox-notice"');
    expect(html).toContain('مستند تجريبي');
  });

  it('tells the public check that a seal was a test, without telling it anything else', async () => {
    const result = await run(sandbox.tenantId, '7001272184');

    const token = await withTenant(db.appPool, sandbox.tenantId, async (tx) => {
      const content = await buildEvidenceContent(tx, result.runId);
      const sealed = await sealEvidence(tx, {
        runId: result.runId,
        content,
        storageKey: `evidence/${sandbox.tenantId}/${result.runId}.html`,
        signingKey: await keys.signingKey(sandbox.tenantId),
      });
      return sealed.publicToken;
    });

    const publicView = await withoutTenant(db.appPool, (tx) => resolvePublicEvidence(tx, token));
    expect(publicView?.sandbox).toBe(true);
    // And still nothing about the subject or the workspace.
    const serialised = JSON.stringify(publicView);
    expect(serialised).not.toContain(sandbox.tenantId);
    expect(serialised).not.toContain('7001272184');
  });

  it('leaves a real document unstamped, so the notice means something', async () => {
    const result = await run(live.tenantId, '7001272184');
    const html = await withTenant(db.appPool, live.tenantId, async (tx) => {
      const content = await buildEvidenceContent(tx, result.runId);
      const sealed = await sealEvidence(tx, {
        runId: result.runId,
        content,
        storageKey: `evidence/${live.tenantId}/${result.runId}.html`,
        signingKey: await keys.signingKey(live.tenantId),
      });
      const document = await buildEvidenceDocument(tx, {
        content,
        contentHash: sealed.contentHash,
        publicToken: sealed.publicToken,
        verifyBaseUrl: 'https://verify.nx.sa',
      });
      return renderEvidenceHtml(document);
    });

    expect(html).not.toContain('data-role="sandbox-notice"');
  });
});
