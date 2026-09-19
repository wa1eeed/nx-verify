import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import { verify } from '../src/verification/verify.js';
import {
  buildEvidenceContent,
  checkEvidence,
  evidenceStorageKey,
  findSeal,
  hashContent,
  listCaseSeals,
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
    await preparePricedTenant(db, tenant.tenantId);

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
    // Four values and no more. The fourth says whether the seal was a test, which is not
    // about any subject and is the one thing the holder of a printed document cannot
    // otherwise find out (ADR-068).
    expect(Object.keys(publicView ?? {}).sort()).toEqual([
      'contentHash',
      'expiresAt',
      'sandbox',
      'signedAt',
    ]);
    expect(publicView?.sandbox).toBe(false);
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

  it('seals a whole portfolio into one bundle', async () => {
    const { createPortfolio, addToPortfolio } = await import('../src/portfolios/portfolios.js');
    const { buildBundleContent, sealBundle } = await import('../src/evidence/evidence.js');

    const portfolioId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createPortfolio(tx, { code: 'AUDIT', nameAr: 'محفظة التدقيق', nameEn: 'Audit' }),
    );

    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ id: string }>(`SELECT id FROM entities WHERE entity_type = 'BUSINESS' LIMIT 2`),
    );
    for (const row of rows) {
      await withTenant(db.appPool, tenant.tenantId, (tx) =>
        addToPortfolio(tx, portfolioId, row.id, 'user:auditor'),
      );
    }

    const sealed = await withTenant(db.appPool, tenant.tenantId, async (tx) =>
      sealBundle(tx, {
        portfolioId,
        runId,
        signingKey: await keys.signingKey(tenant.tenantId),
      }),
    );

    // One file, one hash, one signature. The button that saves a week of assembling
    // folders is only worth anything because it is sealed like a single document.
    expect(sealed.contentHash).toHaveLength(64);

    const content = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      buildBundleContent(tx, portfolioId),
    );

    // A member with no verified facts contributes nothing. A bundle attests to what was
    // verified, so an entity nobody has checked has nothing to attest to.
    expect(sealed.entityCount).toBe(content.entities.length);
    expect(sealed.entityCount).toBeGreaterThan(0);
    expect(sealed.entityCount).toBeLessThanOrEqual(rows.length);
    // It lists what was verified and by whom, and never who the entities are.
    expect(JSON.stringify(content)).not.toContain('7001272184');
    for (const entry of content.entities) {
      for (const field of entry.fields) {
        expect(field.observedAt).toBeTruthy();
      }
    }
  });

  it('refuses to seal an empty portfolio', async () => {
    const { createPortfolio } = await import('../src/portfolios/portfolios.js');
    const { sealBundle } = await import('../src/evidence/evidence.js');

    const portfolioId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createPortfolio(tx, { code: 'EMPTY', nameAr: 'فارغة', nameEn: 'Empty' }),
    );

    await expect(
      withTenant(db.appPool, tenant.tenantId, async (tx) =>
        sealBundle(tx, {
          portfolioId,
          runId,
          signingKey: await keys.signingKey(tenant.tenantId),
        }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4002' });
  });

  it('stamps the row with the moment the document says it was sealed', async () => {
    const { content, sealed } = await seal();
    // The document prints this from the content and the public page prints it from the
    // row. Two values a few milliseconds apart, shown to the same reader as one fact.
    expect(sealed.signedAt.toISOString()).toBe(content.sealedAt);
  });

  it('checks a document handed back by the fingerprint printed on it', async () => {
    const { sealed } = await seal();
    const signingKey = await keys.signingKey(tenant.tenantId);

    const asPrinted = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      checkEvidence(tx, sealed.evidenceId, { contentHash: sealed.contentHash }, signingKey),
    );
    expect(asPrinted).toEqual({ hashMatches: true, signatureValid: true });

    // Somebody else's fingerprint, or a changed one. The seal is still ours; the paper is
    // not what we sealed.
    const other = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      checkEvidence(tx, sealed.evidenceId, { contentHash: 'a'.repeat(64) }, signingKey),
    );
    expect(other).toEqual({ hashMatches: false, signatureValid: true });

    // A fingerprint missing a character would silently become a short buffer that matches
    // nothing, and a typing slip would read as a forgery.
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        checkEvidence(tx, sealed.evidenceId, { contentHash: 'abc123' }, signingKey),
      ),
    ).rejects.toMatchObject({ code: 'NX-4002' });
  });

  it('finds a seal by its public token and by its id, and not one we never issued', async () => {
    const { sealed } = await seal();

    const byToken = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      findSeal(tx, sealed.publicToken),
    );
    expect(byToken?.evidenceId).toBe(sealed.evidenceId);
    expect(byToken?.contentHash).toBe(sealed.contentHash);
    expect(byToken?.keyVersion).toBe(1);
    expect(byToken?.bundle).toBe(false);

    const byId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      findSeal(tx, ` ${sealed.evidenceId} `),
    );
    expect(byId?.evidenceId).toBe(sealed.evidenceId);

    // A token is not a uuid: asking the id half of the question anyway is an error from
    // the database rather than an answer.
    expect(await withTenant(db.appPool, tenant.tenantId, (tx) => findSeal(tx, 'nothing'))).toBeNull();
    expect(await withTenant(db.appPool, tenant.tenantId, (tx) => findSeal(tx, '  '))).toBeNull();
  });

  it('seals a composite file as one document that names what nobody checked', async () => {
    const { defineJourney, openCase, waiveStep } = await import('../src/onboarding/cases.js');
    const { buildCaseBundleContent, sealCaseBundle } = await import('../src/evidence/evidence.js');

    // The run carries its own sealed document before it is bundled, as a run sealed over
    // the API does.
    await seal();

    const caseId = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await defineJourney(tx, {
        code: 'BUNDLE_JOURNEY',
        nameAr: 'تأهيل منشأة',
        steps: [
          { stepKey: 'kyb', productCode: 'KYB_COMPLETE' },
          { stepKey: 'freelance', productCode: 'FREELANCER_CERTIFICATE', required: false },
        ],
      });
      const opened = await openCase(tx, { journeyCode: 'BUNDLE_JOURNEY' });
      // The file as it stands after a session on it: one check ran, one was set aside.
      await tx.query(
        `UPDATE onboarding_case_steps SET run_id = $3, status = 'DONE'
         WHERE tenant_id = $1 AND case_id = $2 AND step_key = 'kyb'`,
        [tx.tenantId, opened.caseId, runId],
      );
      await waiveStep(tx, {
        caseId: opened.caseId,
        stepKey: 'freelance',
        reason: 'DOCUMENT_ON_FILE',
        actorId: randomUUID(),
      });
      return opened.caseId;
    });

    const content = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      buildCaseBundleContent(tx, caseId),
    );

    expect(content.runCount).toBe(1);
    expect(content.fieldCount).toBeGreaterThan(0);
    // A bundle that listed only what was verified would read as a clean file when a check
    // had been set aside, which is the one reading it must never allow.
    const waived = content.steps.find((step) => step.stepKey === 'freelance');
    expect(waived?.status).toBe('WAIVED');
    expect(waived?.waiveReason).toBe('DOCUMENT_ON_FILE');
    expect(waived?.run).toBeNull();
    for (const field of content.steps.flatMap((step) => step.run?.fields ?? [])) {
      expect(field.observedAt).toBeTruthy();
    }
    // Rule 5 and rule 4: neither the provider nor the applicant's number is on a document
    // that will be forwarded to people we never see.
    expect(JSON.stringify(content)).not.toContain('provider.stub');
    expect(JSON.stringify(content)).not.toContain('7001272184');

    const sealed = await withTenant(db.appPool, tenant.tenantId, async (tx) =>
      sealCaseBundle(tx, { caseId, signingKey: await keys.signingKey(tenant.tenantId) }),
    );
    expect(sealed.contentHash).toHaveLength(64);
    expect(sealed.runCount).toBe(1);

    const seals = await withTenant(db.appPool, tenant.tenantId, (tx) => listCaseSeals(tx, caseId));
    expect(seals.map((entry) => entry.evidenceId)).toContain(sealed.evidenceId);
    expect(seals[0]?.bundle).toBe(true);

    // The bundle is sealed against a run that has a document of its own. Without the
    // marker the document route would answer with the bundle and report a missing file
    // for a document that exists.
    const documentKey = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      evidenceStorageKey(tx, runId),
    );
    expect(documentKey).toBe(`evidence/${tenant.tenantId}/${runId}.pdf`);
  });

  it('refuses to seal a file with nothing verified in it', async () => {
    const { defineJourney, openCase } = await import('../src/onboarding/cases.js');
    const { sealCaseBundle } = await import('../src/evidence/evidence.js');

    const caseId = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await defineJourney(tx, {
        code: 'EMPTY_JOURNEY',
        nameAr: 'رحلة بلا تحقق',
        steps: [{ stepKey: 'kyb', productCode: 'KYB_COMPLETE' }],
      });
      return (await openCase(tx, { journeyCode: 'EMPTY_JOURNEY' })).caseId;
    });

    await expect(
      withTenant(db.appPool, tenant.tenantId, async (tx) =>
        sealCaseBundle(tx, { caseId, signingKey: await keys.signingKey(tenant.tenantId) }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4002' });
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
