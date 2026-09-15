import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import { runChecks, type RunChecksDependencies } from '../src/customers/checks.js';
import {
  createRequest,
  discardDraft,
  executeRequest,
  getPreferences,
  getRequest,
  listDrafts,
  lookupCustomer,
  parseSubject,
  requestFromDraft,
  resumeRequests,
  setPreferences,
  settleCheck,
  submitDraft,
  updateDraft,
} from '../src/customers/requests.js';
import { settledPeople } from '../src/customers/checks.js';
import { getWallet } from '../src/billing/wallet.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';
import { scanForPlaintext } from '../../../test/helpers/plaintext-scan.js';
import {
  SANDBOX_FREELANCER,
  SANDBOX_IBAN,
  SANDBOX_UNN,
} from '../../../packages/providers/src/stub/verification-sandbox.js';

/**
 * Handoff phase 4: the verification request of screen 02, run in the background.
 *
 * Every test here goes through the path a click takes: the request is created under the key
 * the form carried, run check by check the way the console's background task and the
 * worker's sweep run it, and read back the way the screen polls it. The assertions are the
 * promises the screen makes: one request per key, each row settling on its own, a failure
 * tried again and never charged, a finished call never charged twice, and nothing typed
 * ever stored in the clear.
 */

const COMPANY_CHECKS = [
  'CR_FULL',
  'ARTICLES_OF_ASSOCIATION',
  'MANAGER_AUTHORITY',
  'NATIONAL_ADDRESS',
  'IBAN_VERIFICATION',
];

describe('verification requests', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let other: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  const depsFor = (tenantId: string): RunChecksDependencies => ({
    inTenant: (work) => withTenant(db.appPool, tenantId, work),
    keys,
    runStepFor: (tx) => fixture.runnerFor(tx),
  });
  const inTenant = <T>(tenantId: string, work: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(db.appPool, tenantId, work);
  const noWait = { retryDelaySeconds: 0, sleep: async () => undefined };

  const runsOf = async (tenantId: string, bundleKey: string) =>
    inTenant(tenantId, async (tx) => {
      const { rows } = await tx.query<{
        product_code: string;
        status: string;
        idempotency_key: string;
      }>(
        `SELECT product_code, status, idempotency_key FROM verification_runs
         WHERE tenant_id = $1 AND bundle_key = $2 ORDER BY created_at`,
        [tx.tenantId, bundleKey],
      );
      return rows;
    });
  const balanceOf = (tenantId: string) =>
    inTenant(tenantId, async (tx) => (await getWallet(tx)).balance);

  let companyId = '';

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Requests Tenant');
    other = await seedTenant(db.appPool, 'Another Subscriber');
    await preparePricedTenant(db, tenant.tenantId, { balanceHalalas: 50_000_00 });
    await preparePricedTenant(db, other.tenantId, { balanceHalalas: 50_000_00 });
  });

  afterAll(async () => {
    await db.close();
  });

  it('reads what was typed by its shape, and says what is wrong without repeating it', () => {
    expect(parseSubject('COMPANY', { number: ' 7001-272184 ' }).subject.idType).toBe('UNN');
    expect(parseSubject('COMPANY', { number: '1010711252' }).subject.idType).toBe('CR');
    expect(parseSubject('FREELANCER', { number: '2107454009' }).subject.idType).toBe('IQAMA');
    expect(parseSubject('FREELANCER', { number: '7001272184' }).problem).toBe('NUMBER');
    expect(
      parseSubject('FREELANCER', { number: '1107454009', certificateNumber: 'fl013988291' }).subject
        .certificate,
    ).toBe('FL-013988291');
    expect(parseSubject('COMPANY', { iban: 'SA28 1000' }).problem).toBe('IBAN');
  });

  it('is one request for one key, and seals what was typed while it waits', async () => {
    const bundleKey = randomUUID();
    const input = {
      kind: 'COMPANY' as const,
      subject: { number: SANDBOX_UNN.ACTIVE, iban: SANDBOX_IBAN.MATCH },
      productCodes: [...COMPANY_CHECKS, 'FREELANCE_CERTIFICATE'],
      bundleKey,
      requestedBy: null,
    };
    const first = await inTenant(tenant.tenantId, (tx) => createRequest(tx, keys, input));
    const second = await inTenant(tenant.tenantId, (tx) => createRequest(tx, keys, input));
    expect(first.created).toBe(true);
    expect(first.status).toBe('QUEUED');
    expect(second).toEqual({ ...first, created: false });

    const view = await inTenant(tenant.tenantId, (tx) => getRequest(tx, keys, first.requestId));
    // The certificate check does not apply to a company, so it was never queued.
    expect(view?.checks.map((check) => check.productCode)).toEqual(COMPANY_CHECKS);
    expect(view?.checks.every((check) => check.status === 'QUEUED')).toBe(true);
    expect(view?.subject).toBe(SANDBOX_UNN.ACTIVE);
    expect(view?.iban?.endsWith('1309')).toBe(true);

    for (const value of [SANDBOX_UNN.ACTIVE, SANDBOX_IBAN.MATCH]) {
      const hits = await inTenant(tenant.tenantId, (tx) => scanForPlaintext(tx, value));
      expect(hits, value).toEqual([]);
    }

    // Run the way the console runs it, then a second time the way a refresh would.
    await executeRequest(depsFor(tenant.tenantId), first.requestId, noWait);
    const done = await inTenant(tenant.tenantId, (tx) => getRequest(tx, keys, first.requestId));
    expect(done?.status).toBe('DONE');
    expect(done?.open).toBe(false);
    expect(done?.entityId).not.toBeNull();
    expect(done?.displayName).toBe('شركة اختبار للتجارة');
    const outcome = (code: string) => done?.checks.find((check) => check.productCode === code);
    expect(outcome('CR_FULL')).toMatchObject({ status: 'DONE', outcome: 'OK', attempts: 1 });
    expect(outcome('NATIONAL_ADDRESS')).toMatchObject({ status: 'DONE', outcome: 'OK' });
    expect(outcome('IBAN_VERIFICATION')).toMatchObject({ status: 'DONE', outcome: 'OK' });
    expect(outcome('MANAGER_AUTHORITY')?.status).toBe('DONE');
    expect(outcome('CR_FULL')?.reference).toMatch(/^VRF-/);
    companyId = done?.entityId ?? '';

    // Once the file holds the customer's identifiers, the request lets go of its copy.
    const sealed = await inTenant(tenant.tenantId, async (tx) => {
      const { rows } = await tx.query<{ subject_enc: Buffer | null; iban_enc: Buffer | null }>(
        `SELECT subject_enc, iban_enc FROM verification_requests WHERE tenant_id = $1 AND id = $2`,
        [tx.tenantId, first.requestId],
      );
      return rows[0];
    });
    expect(sealed).toEqual({ subject_enc: null, iban_enc: null });

    const runs = await runsOf(tenant.tenantId, bundleKey);
    const balance = await balanceOf(tenant.tenantId);
    await executeRequest(depsFor(tenant.tenantId), first.requestId, noWait);
    expect(await runsOf(tenant.tenantId, bundleKey)).toEqual(runs);
    expect(await balanceOf(tenant.tenantId)).toBe(balance);
  });

  it('finds the customer by its unified number or its registration, with where each check stands', async () => {
    const byUnn = await inTenant(tenant.tenantId, (tx) =>
      lookupCustomer(tx, keys, { kind: 'COMPANY', number: SANDBOX_UNN.ACTIVE }),
    );
    expect(byUnn).toMatchObject({
      status: 'FOUND',
      entityId: companyId,
      displayName: 'شركة اختبار للتجارة',
      kind: 'COMPANY',
    });
    const standing = (code: string) =>
      byUnn.standings.find((candidate) => candidate.productCode === code);
    expect(standing('CR_FULL')).toMatchObject({ state: 'VERIFIED', hasResult: true });
    expect(standing('CR_FULL')?.verifiedAt).toBeInstanceOf(Date);
    expect(standing('FREELANCE_CERTIFICATE')?.state).toBe('NOT_APPLICABLE');
    expect(standing('PROPERTY_VERIFICATION')?.state).toBe('COMING_SOON');
    expect(byUnn.account?.endsWith('1309')).toBe(true);

    const byRegistration = await inTenant(tenant.tenantId, (tx) =>
      lookupCustomer(tx, keys, { kind: 'COMPANY', number: '1010711252' }),
    );
    expect(byRegistration.entityId).toBe(companyId);

    const unknown = await inTenant(tenant.tenantId, (tx) =>
      lookupCustomer(tx, keys, { kind: 'COMPANY', number: '1010000001' }),
    );
    expect(unknown.status).toBe('REGISTRATION_UNKNOWN');
    const fresh = await inTenant(tenant.tenantId, (tx) =>
      lookupCustomer(tx, keys, { kind: 'ESTABLISHMENT', number: SANDBOX_UNN.ESTABLISHMENT }),
    );
    expect(fresh.status).toBe('NEW');
    expect(
      fresh.standings.find((candidate) => candidate.productCode === 'ARTICLES_OF_ASSOCIATION')
        ?.state,
    ).toBe('NOT_APPLICABLE');

    // Another subscriber typing the same number finds nobody.
    const elsewhere = await inTenant(other.tenantId, (tx) =>
      lookupCustomer(tx, keys, { kind: 'COMPANY', number: SANDBOX_UNN.ACTIVE }),
    );
    expect(elsewhere.status).toBe('NEW');
    expect(elsewhere.entityId).toBeNull();
  });

  it('tags a row running while its check is queued anywhere for that customer', async () => {
    const queued = await inTenant(tenant.tenantId, (tx) =>
      createRequest(tx, keys, {
        kind: 'COMPANY',
        entityId: companyId,
        subject: {},
        productCodes: ['NATIONAL_ADDRESS'],
        bundleKey: randomUUID(),
        requestedBy: null,
      }),
    );
    const lookup = await inTenant(tenant.tenantId, (tx) =>
      lookupCustomer(tx, keys, { kind: 'COMPANY', number: SANDBOX_UNN.ACTIVE }),
    );
    expect(
      lookup.standings.find((candidate) => candidate.productCode === 'NATIONAL_ADDRESS')?.state,
    ).toBe('RUNNING');
    await executeRequest(depsFor(tenant.tenantId), queued.requestId, noWait);
  });

  it('tries a check that cannot reach the authority again, and charges for none of it', async () => {
    const bundleKey = randomUUID();
    const balance = await balanceOf(tenant.tenantId);
    const created = await inTenant(tenant.tenantId, (tx) =>
      createRequest(tx, keys, {
        kind: 'COMPANY',
        subject: { number: SANDBOX_UNN.SOURCE_DOWN },
        productCodes: ['CR_FULL'],
        bundleKey,
        requestedBy: null,
        maxAttempts: 2,
      }),
    );

    await executeRequest(depsFor(tenant.tenantId), created.requestId, noWait);

    const view = await inTenant(tenant.tenantId, (tx) => getRequest(tx, keys, created.requestId));
    expect(view?.status).toBe('DONE');
    expect(view?.checks[0]).toMatchObject({
      productCode: 'CR_FULL',
      status: 'FAILED',
      outcome: 'ERROR',
      attempts: 2,
      maxAttempts: 2,
    });
    expect(view?.checks[0]?.noteAr).toContain('لم تُحتسب');

    // Two attempts, each under a key of its own, both in the one verification.
    const runs = await runsOf(tenant.tenantId, bundleKey);
    expect(runs.map((run) => run.status)).toEqual(['ERROR', 'ERROR']);
    expect(new Set(runs.map((run) => run.idempotency_key)).size).toBe(2);
    expect(await balanceOf(tenant.tenantId)).toBe(balance);
  });

  it('replays a call a stopped runner finished, rather than charging for it twice', async () => {
    const bundleKey = randomUUID();
    const created = await inTenant(tenant.tenantId, (tx) =>
      createRequest(tx, keys, {
        kind: 'COMPANY',
        entityId: companyId,
        subject: {},
        productCodes: ['NATIONAL_ADDRESS'],
        bundleKey,
        requestedBy: null,
      }),
    );

    // A runner took the check, made the call, and stopped before it could write it down.
    await runChecks(depsFor(tenant.tenantId), {
      entityId: companyId,
      kind: 'BUSINESS',
      identity: {},
      productCodes: ['NATIONAL_ADDRESS'],
      bundleKey,
      attempt: 1,
      requestedBy: null,
    });
    await inTenant(tenant.tenantId, (tx) =>
      tx.query(
        `UPDATE verification_request_checks
         SET status = 'RUNNING', attempts = 1, locked_at = now() - interval '20 minutes'
         WHERE tenant_id = $1 AND request_id = $2`,
        [tx.tenantId, created.requestId],
      ),
    );
    const balance = await balanceOf(tenant.tenantId);
    const runs = await runsOf(tenant.tenantId, bundleKey);
    expect(runs).toHaveLength(1);

    await executeRequest(depsFor(tenant.tenantId), created.requestId, noWait);

    const view = await inTenant(tenant.tenantId, (tx) => getRequest(tx, keys, created.requestId));
    expect(view?.checks[0]).toMatchObject({ status: 'DONE', outcome: 'OK', attempts: 1 });
    expect(await runsOf(tenant.tenantId, bundleKey)).toEqual(runs);
    expect(await balanceOf(tenant.tenantId)).toBe(balance);
  });

  it('leaves a check another runner holds to that runner', async () => {
    const bundleKey = randomUUID();
    const created = await inTenant(tenant.tenantId, (tx) =>
      createRequest(tx, keys, {
        kind: 'COMPANY',
        entityId: companyId,
        subject: {},
        productCodes: ['CR_FULL'],
        bundleKey,
        requestedBy: null,
      }),
    );
    await inTenant(tenant.tenantId, (tx) =>
      tx.query(
        `UPDATE verification_request_checks SET status = 'RUNNING', attempts = 1, locked_at = now()
         WHERE tenant_id = $1 AND request_id = $2`,
        [tx.tenantId, created.requestId],
      ),
    );
    await executeRequest(depsFor(tenant.tenantId), created.requestId, noWait);
    const view = await inTenant(tenant.tenantId, (tx) => getRequest(tx, keys, created.requestId));
    expect(view?.checks[0]?.status).toBe('RUNNING');
    expect(await runsOf(tenant.tenantId, bundleKey)).toEqual([]);
  });

  it('asks again only about the managers whose call did not settle', async () => {
    const bundleKey = randomUUID();
    await runChecks(depsFor(tenant.tenantId), {
      entityId: companyId,
      kind: 'BUSINESS',
      identity: {},
      productCodes: ['MANAGER_AUTHORITY'],
      bundleKey,
      requestedBy: null,
    });
    const settled = await inTenant(tenant.tenantId, (tx) =>
      settledPeople(tx, bundleKey, 'MANAGER_AUTHORITY'),
    );
    expect(settled.size).toBeGreaterThan(0);

    const runs = await runsOf(tenant.tenantId, bundleKey);
    const retry = await runChecks(depsFor(tenant.tenantId), {
      entityId: companyId,
      kind: 'BUSINESS',
      identity: {},
      productCodes: ['MANAGER_AUTHORITY'],
      bundleKey,
      attempt: 2,
      skipPeople: [...settled.keys()],
      requestedBy: null,
    });
    expect(retry.outcomes).toEqual([]);
    expect(await runsOf(tenant.tenantId, bundleKey)).toEqual(runs);
  });

  it('settles a check from every call it made', () => {
    const ok = { status: 'OK' as const, noteAr: null, reference: 'VRF-1' };
    const notFound = { status: 'NOT_FOUND' as const, noteAr: 'لا توجد بيانات', reference: 'VRF-2' };
    const error = { status: 'ERROR' as const, noteAr: 'تعذّر', reference: null };
    const refused = { status: 'REFUSED' as const, noteAr: 'الرصيد لا يكفي', reference: null };
    const skipped = { status: 'SKIPPED' as const, noteAr: 'أدخل رقم الآيبان', reference: null };

    expect(settleCheck([ok, ok], 1, 2)).toMatchObject({ status: 'DONE', outcome: 'OK' });
    expect(settleCheck([ok, notFound], 1, 2)).toMatchObject({ status: 'DONE', outcome: 'PARTIAL' });
    // Not found is an answer, and a charged one (PLAN.md, decision 4).
    expect(settleCheck([notFound], 1, 2)).toMatchObject({ status: 'DONE', outcome: 'NOT_FOUND' });
    expect(settleCheck([ok, error], 1, 2)).toMatchObject({ status: 'QUEUED', outcome: 'ERROR' });
    expect(settleCheck([error], 2, 2)).toMatchObject({ status: 'FAILED', outcome: 'ERROR' });
    expect(settleCheck([refused], 1, 2)).toMatchObject({
      status: 'FAILED',
      outcome: 'REFUSED',
      noteAr: 'الرصيد لا يكفي',
    });
    expect(settleCheck([ok, refused], 1, 2)).toMatchObject({ status: 'DONE', outcome: 'PARTIAL' });
    expect(settleCheck([skipped], 1, 2)).toMatchObject({
      status: 'SKIPPED',
      noteAr: 'أدخل رقم الآيبان',
    });
  });

  it('keeps a draft sealed, lets it change, and runs it once when submitted', async () => {
    const bundleKey = randomUUID();
    const draft = await inTenant(tenant.tenantId, (tx) =>
      createRequest(tx, keys, {
        kind: 'FREELANCER',
        subject: {
          number: SANDBOX_FREELANCER.NATIONAL_ID,
          certificateNumber: SANDBOX_FREELANCER.ACTIVE,
          iban: SANDBOX_IBAN.MATCH,
        },
        productCodes: ['FREELANCE_CERTIFICATE'],
        bundleKey,
        requestedBy: null,
        draft: true,
      }),
    );
    expect(draft.status).toBe('DRAFT');

    const drafts = await inTenant(tenant.tenantId, (tx) => listDrafts(tx, keys));
    expect(drafts.map((entry) => entry.requestId)).toContain(draft.requestId);
    expect(drafts.find((entry) => entry.requestId === draft.requestId)?.label).toBe(
      SANDBOX_FREELANCER.NATIONAL_ID,
    );
    expect(await inTenant(other.tenantId, (tx) => listDrafts(tx, keys))).toEqual([]);

    for (const value of [
      SANDBOX_FREELANCER.NATIONAL_ID,
      SANDBOX_FREELANCER.ACTIVE,
      SANDBOX_FREELANCER.ACTIVE.replace('-', ''),
    ]) {
      const hits = await inTenant(tenant.tenantId, (tx) => scanForPlaintext(tx, value));
      expect(hits, value).toEqual([]);
    }

    const pending = await inTenant(tenant.tenantId, (tx) => getRequest(tx, keys, draft.requestId));
    expect(pending?.checks).toEqual([]);
    expect(
      await inTenant(tenant.tenantId, (tx) =>
        updateDraft(tx, keys, draft.requestId, {
          productCodes: ['FREELANCE_CERTIFICATE', 'IBAN_VERIFICATION', 'CR_FULL'],
        }),
      ),
    ).toBe(true);

    // Another subscriber cannot run it, or even find it.
    await expect(
      inTenant(other.tenantId, (tx) =>
        submitDraft(tx, keys, draft.requestId, { productCodes: ['FREELANCE_CERTIFICATE'] }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4041' });
    expect(
      await inTenant(other.tenantId, (tx) => getRequest(tx, keys, draft.requestId)),
    ).toBeNull();

    const submitted = await inTenant(tenant.tenantId, (tx) =>
      submitDraft(tx, keys, draft.requestId, {
        productCodes: ['FREELANCE_CERTIFICATE', 'IBAN_VERIFICATION', 'CR_FULL'],
      }),
    );
    const again = await inTenant(tenant.tenantId, (tx) =>
      submitDraft(tx, keys, draft.requestId, { productCodes: ['FREELANCE_CERTIFICATE'] }),
    );
    expect(submitted).toMatchObject({ status: 'QUEUED', created: true });
    expect(again).toMatchObject({ status: 'QUEUED', created: false });

    await executeRequest(depsFor(tenant.tenantId), draft.requestId, noWait);
    const view = await inTenant(tenant.tenantId, (tx) => getRequest(tx, keys, draft.requestId));
    // A registry check does not apply to a freelancer, so it never joined the request.
    expect(view?.checks.map((check) => [check.productCode, check.outcome])).toEqual([
      ['FREELANCE_CERTIFICATE', 'OK'],
      ['IBAN_VERIFICATION', 'OK'],
    ]);
    expect(view?.displayName).not.toBeNull();

    // The certificate number went to the authority in the shape it expects, from the file.
    const lookup = await inTenant(tenant.tenantId, (tx) =>
      lookupCustomer(tx, keys, { kind: 'FREELANCER', number: SANDBOX_FREELANCER.NATIONAL_ID }),
    );
    expect(lookup).toMatchObject({ status: 'FOUND', kind: 'FREELANCER', hasCertificate: true });
    const again2 = await runChecks(depsFor(tenant.tenantId), {
      entityId: lookup.entityId,
      kind: 'FREELANCER',
      identity: {},
      productCodes: ['FREELANCE_CERTIFICATE'],
      bundleKey: randomUUID(),
      requestedBy: null,
    });
    expect(again2.outcomes[0]?.status).toBe('OK');
  });

  it('runs one check of a draft now, and keeps the draft for the rest', async () => {
    const draft = await inTenant(tenant.tenantId, (tx) =>
      createRequest(tx, keys, {
        kind: 'ESTABLISHMENT',
        subject: { number: SANDBOX_UNN.ESTABLISHMENT, iban: SANDBOX_IBAN.MATCH },
        productCodes: ['CR_FULL', 'NATIONAL_ADDRESS', 'IBAN_VERIFICATION'],
        bundleKey: randomUUID(),
        requestedBy: null,
        draft: true,
      }),
    );
    const bundleKey = randomUUID();
    const one = await inTenant(tenant.tenantId, (tx) =>
      requestFromDraft(tx, keys, draft.requestId, {
        productCodes: ['CR_FULL'],
        bundleKey,
        requestedBy: null,
      }),
    );
    const twice = await inTenant(tenant.tenantId, (tx) =>
      requestFromDraft(tx, keys, draft.requestId, {
        productCodes: ['CR_FULL'],
        bundleKey,
        requestedBy: null,
      }),
    );
    expect(twice).toEqual({ ...one, created: false });
    await executeRequest(depsFor(tenant.tenantId), one.requestId, noWait);

    const ran = await inTenant(tenant.tenantId, (tx) => getRequest(tx, keys, one.requestId));
    expect(ran?.checks.map((check) => [check.productCode, check.outcome])).toEqual([
      ['CR_FULL', 'OK'],
    ]);
    expect(ran?.displayName).toBe('مؤسسة اختبار للمقاولات');
    const kept = await inTenant(tenant.tenantId, (tx) => getRequest(tx, keys, draft.requestId));
    expect(kept).toMatchObject({
      status: 'DRAFT',
      productCodes: ['CR_FULL', 'NATIONAL_ADDRESS', 'IBAN_VERIFICATION'],
    });
    expect(kept?.iban?.endsWith('1309')).toBe(true);
  });

  it('takes an IBAN typed into a saved draft, sealed like the rest', async () => {
    const draft = await inTenant(tenant.tenantId, (tx) =>
      createRequest(tx, keys, {
        kind: 'COMPANY',
        entityId: companyId,
        subject: {},
        productCodes: ['IBAN_VERIFICATION'],
        bundleKey: randomUUID(),
        requestedBy: null,
        draft: true,
      }),
    );
    expect(
      await inTenant(tenant.tenantId, (tx) =>
        updateDraft(tx, keys, draft.requestId, {
          productCodes: ['IBAN_VERIFICATION'],
          iban: SANDBOX_IBAN.BLOCKED,
        }),
      ),
    ).toBe(true);
    const hits = await inTenant(tenant.tenantId, (tx) =>
      scanForPlaintext(tx, SANDBOX_IBAN.BLOCKED),
    );
    expect(hits).toEqual([]);
    const saved = await inTenant(tenant.tenantId, (tx) => getRequest(tx, keys, draft.requestId));
    expect(saved?.iban?.endsWith('1234')).toBe(true);

    await expect(
      inTenant(tenant.tenantId, (tx) =>
        updateDraft(tx, keys, draft.requestId, { productCodes: [], iban: 'SA12' }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4002' });
  });

  it('throws a draft away with what was typed in it', async () => {
    const draft = await inTenant(tenant.tenantId, (tx) =>
      createRequest(tx, keys, {
        kind: 'COMPANY',
        subject: { number: SANDBOX_UNN.IN_LIQUIDATION, iban: SANDBOX_IBAN.OTHER_NAME },
        productCodes: ['CR_FULL'],
        bundleKey: randomUUID(),
        requestedBy: null,
        draft: true,
      }),
    );
    expect(await inTenant(tenant.tenantId, (tx) => discardDraft(tx, draft.requestId))).toBe(true);
    const view = await inTenant(tenant.tenantId, (tx) => getRequest(tx, keys, draft.requestId));
    expect(view).toMatchObject({ status: 'CANCELLED', iban: null });
    await expect(
      inTenant(tenant.tenantId, (tx) =>
        submitDraft(tx, keys, draft.requestId, { productCodes: ['CR_FULL'] }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4041' });
  });

  it('refuses a request with nothing that applies, and a new customer found by registration', async () => {
    await expect(
      inTenant(tenant.tenantId, (tx) =>
        createRequest(tx, keys, {
          kind: 'ESTABLISHMENT',
          subject: { number: SANDBOX_UNN.ESTABLISHMENT },
          productCodes: ['ARTICLES_OF_ASSOCIATION'],
          bundleKey: randomUUID(),
          requestedBy: null,
        }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4002' });
    await expect(
      inTenant(tenant.tenantId, (tx) =>
        createRequest(tx, keys, {
          kind: 'COMPANY',
          subject: { number: '1010000001' },
          productCodes: ['CR_FULL'],
          bundleKey: randomUUID(),
          requestedBy: null,
        }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4002' });
  });

  it('picks up what nobody is running, and closes what has waited too long', async () => {
    const make = () =>
      inTenant(tenant.tenantId, (tx) =>
        createRequest(tx, keys, {
          kind: 'COMPANY',
          entityId: companyId,
          subject: {},
          productCodes: ['NATIONAL_ADDRESS'],
          bundleKey: randomUUID(),
          requestedBy: null,
        }),
      );
    const left = await make();
    const fresh = await make();
    const stale = await make();
    await inTenant(tenant.tenantId, async (tx) => {
      await tx.query(
        `UPDATE verification_requests SET submitted_at = now() - interval '2 minutes'
         WHERE tenant_id = $1 AND id = $2`,
        [tx.tenantId, left.requestId],
      );
      await tx.query(
        `UPDATE verification_requests SET submitted_at = now() - interval '2 days'
         WHERE tenant_id = $1 AND id = $2`,
        [tx.tenantId, stale.requestId],
      );
    });

    // The other subscriber's sweep touches none of it.
    expect(await resumeRequests(depsFor(other.tenantId), noWait)).toBe(0);

    await resumeRequests(depsFor(tenant.tenantId), noWait);
    const status = async (requestId: string) =>
      inTenant(tenant.tenantId, (tx) => getRequest(tx, keys, requestId));
    expect((await status(left.requestId))?.checks[0]).toMatchObject({
      status: 'DONE',
      outcome: 'OK',
    });
    // Pressed a moment ago: the console's own runner has it.
    expect((await status(fresh.requestId))?.checks[0]?.status).toBe('QUEUED');
    const expired = await status(stale.requestId);
    expect(expired?.status).toBe('DONE');
    expect(expired?.checks[0]).toMatchObject({ status: 'FAILED', outcome: 'ERROR' });
    expect(expired?.checks[0]?.noteAr).toContain('انتهت مهلة');

    await executeRequest(depsFor(tenant.tenantId), fresh.requestId, noWait);
  });

  it('keeps each subscriber’s choice about prices to that subscriber', async () => {
    expect(await inTenant(tenant.tenantId, (tx) => getPreferences(tx))).toEqual({
      showPrices: true,
    });
    await inTenant(tenant.tenantId, (tx) => setPreferences(tx, { showPrices: false }));
    expect(await inTenant(tenant.tenantId, (tx) => getPreferences(tx))).toEqual({
      showPrices: false,
    });
    expect(await inTenant(other.tenantId, (tx) => getPreferences(tx))).toEqual({
      showPrices: true,
    });
  });
});
