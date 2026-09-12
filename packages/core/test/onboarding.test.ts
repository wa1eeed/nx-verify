import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import {
  advanceCase,
  defineJourney,
  getCase,
  listCases,
  listJourneys,
  openCase,
  waiveStep,
} from '../src/onboarding/cases.js';
import { listQueue } from '../src/review/queue.js';
import { getWallet } from '../src/billing/wallet.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';

/**
 * Unit 45 acceptance: onboarding as a file rather than a sequence of calls.
 *
 * The questions this has to answer are the ones a compliance officer is asked a year
 * later: was this applicant acceptable, what was checked before we said so, what was
 * waived and by whom, and what was still outstanding when the clock ran out.
 */

const SUBJECT = {
  unn: '7001272184',
  manager: { id: '1098765432', id_type: 'NATIONAL_ID' as const },
};

describe('onboarding cases', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();
  const actor = '1c9b0000-0000-4000-8000-000000000001';

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Onboarding Tenant');
    await preparePricedTenant(db, tenant.tenantId);

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      defineJourney(tx, {
        code: 'MERCHANT_LLC',
        nameAr: 'تأهيل تاجر: شركة ذات مسؤولية محدودة',
        slaHours: 48,
        steps: [
          { stepKey: 'company', productCode: 'KYB_COMPLETE' },
          // The address check asks for the unified number and refuses anything else, so
          // the journey hands it exactly that.
          { stepKey: 'address', productCode: 'ADDRESS_ONLY', subjectMap: { unn: 'unn' } },
          {
            stepKey: 'freelance',
            productCode: 'FREELANCER_CERTIFICATE',
            required: false,
            // A company is not a freelancer, and the file should say that rather than
            // leaving an unexplained gap.
            appliesWhen: { op: 'eq', field: 'cr.status', value: 'FREELANCE' },
          },
        ],
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  const open = (clientRef: string) =>
    withTenant(db.appPool, tenant.tenantId, (tx) =>
      openCase(tx, { journeyCode: 'MERCHANT_LLC', clientRef, openedBy: actor }),
    );

  const advance = (caseId: string) =>
    withTenant(db.appPool, tenant.tenantId, (tx) =>
      advanceCase(tx, {
        caseId,
        subject: SUBJECT,
        subjectIdentifiers: [{ idType: 'UNN', value: SUBJECT.unn }],
        subjectDisplayName: 'مؤسسة نماء للمقاولات',
        runStep: fixture.runnerFor(tx),
        keys,
        actorId: actor,
      }),
    );

  it('describes a journey as rows, so a customer adds one without a deployment', async () => {
    const journeys = await withTenant(db.appPool, tenant.tenantId, (tx) => listJourneys(tx));
    expect(journeys).toHaveLength(1);
    expect(journeys[0]?.steps.map((step) => step.stepKey)).toEqual([
      'company',
      'address',
      'freelance',
    ]);
  });

  it('opens a file with a reference, a clock and the checks it requires', async () => {
    const opened = await open('ONB-TEST-1');

    expect(opened.reference).toMatch(/^ONB-\d{4}-\d{6}$/);
    expect(opened.status).toBe('IN_PROGRESS');
    expect(opened.steps).toHaveLength(3);
    expect(opened.steps.every((step) => step.status === 'PENDING')).toBe(true);
    expect(opened.dueAt.getTime()).toBeGreaterThan(opened.openedAt.getTime());
    expect(opened.overdue).toBe(false);
  });

  it('runs the checks, marks what does not apply, and decides the file', async () => {
    const opened = await open('ONB-TEST-2');
    const { case: decided, ran } = await advance(opened.caseId);

    expect(ran.map((entry) => entry.stepKey)).toEqual(['company', 'address', 'freelance']);

    const byKey = new Map(decided.steps.map((step) => [step.stepKey, step]));
    expect(byKey.get('company')?.status).toBe('DONE');
    expect(byKey.get('company')?.runId).toBeTruthy();
    expect(byKey.get('address')?.status).toBe('DONE');
    // Said rather than silently absent: this applicant is not a freelancer.
    expect(byKey.get('freelance')?.status).toBe('NOT_APPLICABLE');

    // And the file reached an outcome rather than sitting open.
    expect(['APPROVED', 'REJECTED', 'IN_REVIEW']).toContain(decided.status);
    expect(decided.entityId).toBeTruthy();
  });

  it('re-advancing a file runs nothing twice and charges nothing twice', async () => {
    const opened = await open('ONB-TEST-3');
    await advance(opened.caseId);

    const wallet = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    const again = await advance(opened.caseId).catch((error: Error) => error);

    // A closed file refuses; an open one runs nothing because nothing is pending.
    if (again instanceof Error) {
      expect(String(again)).toMatch(/closed/);
    } else {
      expect(again.ran).toEqual([]);
    }

    const after = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    expect(after.balance).toBe(wallet.balance);
  });

  it('sends a file with a failed required check to a person, not to a rejection', async () => {
    const opened = await open('ONB-TEST-4');

    const result = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      advanceCase(tx, {
        caseId: opened.caseId,
        // An identifier the stub answers with a network failure, which is a provider
        // having a bad afternoon rather than an applicant being unacceptable.
        subject: { unn: '7000000001' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7000000001' }],
        runStep: fixture.runnerFor(tx),
        keys,
        actorId: actor,
      }),
    );

    expect(result.case.status).toBe('IN_REVIEW');
    expect(result.case.closedAt).toBeNull();
    // Auto rejecting on a provider's bad afternoon would reject real applicants.
    expect(result.case.outcome).not.toBe('FAIL');
  });

  it('lets a person waive a check, with a reason from a closed set', async () => {
    const opened = await open('ONB-TEST-5');

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      waiveStep(tx, {
        caseId: opened.caseId,
        stepKey: 'address',
        reason: 'DOCUMENT_ON_FILE',
        actorId: actor,
      }),
    );

    const after = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getCase(tx, opened.caseId),
    );
    const waived = after?.steps.find((step) => step.stepKey === 'address');
    expect(waived?.status).toBe('WAIVED');
    expect(waived?.waiveReason).toBe('DOCUMENT_ON_FILE');

    // Rule 6: the reason is a code, so "how often do we waive the address check" is a
    // question the platform can answer.
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        tx.query(
          `UPDATE onboarding_case_steps SET waive_reason = 'because the manager said so'
           WHERE tenant_id = $1 AND case_id = $2 AND step_key = 'address'`,
          [tenant.tenantId, opened.caseId],
        ),
      ),
    ).rejects.toThrow();
  });

  it('opens a review queue item when a file needs a person', async () => {
    const queue = await withTenant(db.appPool, tenant.tenantId, (tx) => listQueue(tx, { limit: 50 }));
    // Every file that went to review put work in front of somebody: a review nobody is
    // given is a review nobody does.
    expect(queue.length).toBeGreaterThan(0);
  });

  it('lists the open files with their progress and their clock', async () => {
    const cases = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listCases(tx, { open: true }),
    );

    expect(cases.length).toBeGreaterThan(0);
    for (const summary of cases) {
      expect(summary.reference).toMatch(/^ONB-/);
      expect(summary.total).toBeGreaterThan(0);
      expect(summary.done).toBeLessThanOrEqual(summary.total);
    }
  });
});
