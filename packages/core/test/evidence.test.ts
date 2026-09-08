import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import { verify } from '../src/verification/verify.js';
import {
  buildEvidenceContent,
  checkEvidence,
  hashContent,
  resolvePublicEvidence,
  sealEvidence,
} from '../src/evidence/evidence.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';

/**
 * The evidence file, which docs/01-blueprint.md calls the strongest commercial output.
 *
 * What makes it worth anything is that someone with no account here can check it later,
 * and that checking it tells them nothing about the subject.
 */

describe('sealed evidence', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let runId: string;
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Evidence Tenant');
    await preparePricedTenant(db.appPool, tenant.tenantId);

    const result = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'KYB_COMPLETE',
        subject: { unn: '7001272184', manager: { id: '1098765432', id_type: 'NATIONAL_ID' } },
        subjectIdentifiers: [{ idType: 'UNN', value: '7001272184' }],
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );
    runId = result.runId;
  });

  afterAll(async () => {
    await db.close();
  });

  const seal = () =>
    withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const content = await buildEvidenceContent(tx, runId);
      const sealed = await sealEvidence(tx, {
        runId,
        content,
        storageKey: `evidence/${tenant.tenantId}/${runId}.pdf`,
        signingKey: await keys.signingKey(tenant.tenantId),
      });
      return { content, sealed };
    });

  it('seals the content and returns a token that carries no information', async () => {
    const { sealed } = await seal();
    expect(sealed.contentHash).toHaveLength(64);
    expect(sealed.publicToken.length).toBeGreaterThan(20);
    // The token appears on a printed document that will be forwarded to strangers.
    expect(sealed.publicToken).not.toContain(runId);
    expect(sealed.publicToken).not.toContain(tenant.tenantId);
  });

  it('records the authority of each field and never the provider', async () => {
    const { content } = await seal();
    expect(content.fields.length).toBeGreaterThan(0);
    for (const field of content.fields) {
      expect(field.authority).toBeTruthy();
      expect(field.observedAt).toBeTruthy();
    }
    expect(JSON.stringify(content)).not.toContain('provider.stub');
  });

  it('confirms a document that still matches, and rejects one that does not', async () => {
    const { content, sealed } = await seal();
    const signingKey = await keys.signingKey(tenant.tenantId);

    const intact = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      checkEvidence(tx, sealed.evidenceId, content, signingKey),
    );
    expect(intact).toEqual({ hashMatches: true, signatureValid: true });

    // Genuinely different from what was sealed. Asserting on a value the run already
    // carries would make this test pass without testing anything.
    const altered = { ...content, status: 'TAMPERED', decision: 'FAIL' };
    expect(altered.status).not.toBe(content.status);
    const tampered = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      checkEvidence(tx, sealed.evidenceId, altered, signingKey),
    );
    // The signature is still ours. The document is not what we signed.
    expect(tampered.hashMatches).toBe(false);
    expect(tampered.signatureValid).toBe(true);
  });

  it('signs with a key that is neither the hashing key nor the encryption key', async () => {
    const [signing, hmac, encryption] = await Promise.all([
      keys.signingKey(tenant.tenantId),
      keys.hmacKey(tenant.tenantId),
      keys.encryptionKey(tenant.tenantId),
    ]);
    expect(signing.equals(hmac)).toBe(false);
    expect(signing.equals(encryption)).toBe(false);
  });

  it('answers a public check with the seal and nothing else', async () => {
    const { sealed, content } = await seal();

    // No tenant in scope: whoever scans the code has no account here.
    const publicView = await withoutTenant(db.appPool, (tx) =>
      resolvePublicEvidence(tx, sealed.publicToken),
    );

    expect(publicView?.contentHash).toBe(sealed.contentHash);
    expect(publicView?.signedAt).toBeInstanceOf(Date);

    // A public verification page that leaks personal data is worse than not having one.
    const serialised = JSON.stringify(publicView);
    expect(serialised).not.toContain(tenant.tenantId);
    expect(serialised).not.toContain(runId);
    expect(serialised).not.toContain('7001272184');
    expect(Object.keys(publicView ?? {}).sort()).toEqual(['contentHash', 'expiresAt', 'signedAt']);
    expect(hashContent(content).toString('hex')).toBe(publicView?.contentHash);
  });

  it('refuses an unknown or expired token', async () => {
    const unknown = await withoutTenant(db.appPool, (tx) =>
      resolvePublicEvidence(tx, 'not-a-real-token'),
    );
    expect(unknown).toBeNull();

    const expired = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const content = await buildEvidenceContent(tx, runId);
      return sealEvidence(tx, {
        runId,
        content,
        storageKey: 'evidence/expired.pdf',
        signingKey: await keys.signingKey(tenant.tenantId),
        expiresAt: new Date(Date.now() - 1000),
      });
    });

    const gone = await withoutTenant(db.appPool, (tx) =>
      resolvePublicEvidence(tx, expired.publicToken),
    );
    expect(gone).toBeNull();
  });

  it('keeps evidence inside the tenant that produced it', async () => {
    const { sealed } = await seal();
    const other = await seedTenant(db.appPool, 'Evidence Other Tenant');

    const rows = await withTenant(db.appPool, other.tenantId, async (tx) => {
      const result = await tx.query(`SELECT id FROM evidence WHERE id = $1`, [sealed.evidenceId]);
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });
});
