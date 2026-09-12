import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../src/verification/verify.js';
import { buildEvidenceContent, sealEvidence } from '../src/evidence/evidence.js';
import { buildEvidenceDocument, verificationQrSvg } from '../src/evidence/document.js';
import { renderEvidenceHtml } from '../src/evidence/render.js';
import { FilesystemEvidenceStore, InMemoryEvidenceStore } from '../src/evidence/store.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The evidence document: the page the customer hands to a bank or an auditor.
 *
 * The tests here are the interface and privacy rules read as document rules. A line
 * appears only with its authority and its date (rule 6), the provider is nowhere on the
 * page (rule 5), the code on it opens the public page and carries nothing else, and
 * identifiers are in an explicit left to right run so a number cannot be read back wrong.
 */

describe('evidence document', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let runId: string;
  let html: string;
  let verifyUrl: string;
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'شركة الدليل المحدودة');
    await preparePricedTenant(db, tenant.tenantId);

    runId = (
      await withTenant(db.appPool, tenant.tenantId, (tx) =>
        verify(tx, {
          productCode: 'KYB_COMPLETE',
          subject: { unn: '7001272184', manager: { id: '1098765432', id_type: 'NATIONAL_ID' } },
          subjectIdentifiers: [{ idType: 'UNN', value: '7001272184' }],
          triggeredBy: 'API',
          modeAtExecution: 'BYOC',
          runStep: fixture.runnerFor(tx),
          keys,
        }),
      )
    ).runId;

    html = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const content = await buildEvidenceContent(tx, runId);
      const sealed = await sealEvidence(tx, {
        runId,
        content,
        storageKey: `evidence/${tenant.tenantId}/${runId}.html`,
        signingKey: await keys.signingKey(tenant.tenantId),
      });
      const document = await buildEvidenceDocument(tx, {
        content,
        contentHash: sealed.contentHash,
        publicToken: sealed.publicToken,
        verifyBaseUrl: 'https://verify.nx.sa',
      });
      verifyUrl = document.verifyUrl;
      return renderEvidenceHtml(document);
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('gives every printed fact an authority and a date', async () => {
    const document = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const content = await buildEvidenceContent(tx, runId);
      return buildEvidenceDocument(tx, {
        content,
        contentHash: 'a'.repeat(64),
        publicToken: 'token',
        verifyBaseUrl: 'https://verify.nx.sa',
      });
    });

    expect(document.fields.length).toBeGreaterThan(0);
    for (const field of document.fields) {
      expect(field.authority).not.toBe('');
      // A date, not a timestamp: the hour a record was read is not the customer's business.
      expect(field.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('drops a field that has no authority rather than printing it bare', async () => {
    const document = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const content = await buildEvidenceContent(tx, runId);
      content.fields.push({
        fieldPath: 'unsourced.claim',
        authority: null,
        observedAt: '2026-01-01T00:00:00.000Z',
      });
      return buildEvidenceDocument(tx, {
        content,
        contentHash: 'a'.repeat(64),
        publicToken: 'token',
        verifyBaseUrl: 'https://verify.nx.sa',
      });
    });

    expect(document.fields.some((field) => field.labelAr === 'unsourced.claim')).toBe(false);
    expect(await renderEvidenceHtml(document)).not.toContain('unsourced.claim');
  });

  it('names the authority on the page and never the provider', () => {
    expect(html).toContain('الجهة');
    expect(html).not.toContain('provider.stub');
    expect(html.toLowerCase()).not.toContain('provider');
  });

  it('prints no identifier of the subject', () => {
    // Rule 4 reaches the paper too. The document says what was checked, not the number.
    expect(html).not.toContain('7001272184');
    expect(html).not.toContain('1098765432');
  });

  it('is right to left, with identifiers and dates in a left to right run', () => {
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain(`<bdi dir="ltr" class="mono">${runId}</bdi>`);
    expect(html).toMatch(/<bdi dir="ltr" class="mono" data-role="hash">[0-9a-f]{64}<\/bdi>/);
    // No rgba shadows anywhere on the page, per the interface rules.
    expect(html).not.toContain('rgba');
    expect(html).not.toContain('box-shadow');
  });

  it('carries the seal, the hash and the sealing time', () => {
    expect(html).toContain('data-role="seal"');
    expect(html).toContain('data-role="hash"');
    expect(html).toContain('data-role="sealed-at"');
  });

  it('encodes only the public verification address in the code', async () => {
    const svg = await verificationQrSvg(verifyUrl);
    expect(svg.startsWith('<?xml') || svg.startsWith('<svg')).toBe(true);
    expect(html).toContain('<svg');
    // The address itself carries nothing about the subject.
    expect(verifyUrl).not.toContain(tenant.tenantId);
    expect(verifyUrl).not.toContain(runId);
    expect(verifyUrl).not.toContain('7001272184');
  });

  it('escapes a subscriber name that contains markup', async () => {
    const document = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const content = await buildEvidenceContent(tx, runId);
      return buildEvidenceDocument(tx, {
        content,
        contentHash: 'a'.repeat(64),
        publicToken: 'token',
        verifyBaseUrl: 'https://verify.nx.sa',
      });
    });
    document.header.tenantName = '<script>alert(1)</script>';

    const rendered = await renderEvidenceHtml(document);
    expect(rendered).not.toContain('<script>alert(1)</script>');
    expect(rendered).toContain('&lt;script&gt;');
  });
});

describe('evidence storage', () => {
  it('keeps what it was given, under the key it was given', async () => {
    const store = new InMemoryEvidenceStore();
    await store.put('evidence/t/r.html', '<html></html>');
    expect(await store.get('evidence/t/r.html')).toBe('<html></html>');
    expect(await store.exists('evidence/t/r.html')).toBe(true);
    expect(await store.exists('evidence/t/other.html')).toBe(false);
  });

  it('refuses a key that climbs out of its root', async () => {
    const store = new FilesystemEvidenceStore(await mkdtemp(join(tmpdir(), 'nx-evidence-')));
    await store.put('evidence/t/r.html', 'kept');
    expect(await store.get('evidence/t/r.html')).toBe('kept');
    // Otherwise one subscriber's document could be written over another's.
    await expect(store.put('../escaped.html', 'x')).rejects.toThrow(/escapes/);
  });
});
