import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { advanceCase, defineJourney, openCase } from '../src/onboarding/cases.js';
import { defineAction, listCaseActions } from '../src/onboarding/actions.js';
import { registerEndpoint } from '../src/webhooks/dispatch.js';
import { addChannel } from '../src/notifications/notifications.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';

/**
 * Unit 46 acceptance: what happens after the file is decided.
 *
 * This is the step where a customer stops describing us as a data source. The tests are
 * about routing and about restraint: the right target for the right outcome, and a
 * payload that carries the file rather than the applicant, because a webhook lands in a
 * system we do not control exactly as an email does.
 */

const SUBJECT = {
  unn: '7001272184',
  manager: { id: '1098765432', id_type: 'NATIONAL_ID' as const },
};

describe('what a decided file sets off', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let endpointId = '';
  let channelId = '';
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Acting Tenant');
    await preparePricedTenant(db, tenant.tenantId);

    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await defineJourney(tx, {
        code: 'MERCHANT',
        nameAr: 'تأهيل تاجر',
        steps: [{ stepKey: 'company', productCode: 'KYB_COMPLETE' }],
      });

      endpointId = await registerEndpoint(tx, {
        url: 'https://customer.example/activate',
        secretRef: 'kms://tenants/acting/webhook',
        events: ['verification.completed'],
      });
      channelId = await addChannel(tx, {
        address: 'compliance@acting.example.sa',
        verified: true,
      });

      // Two different targets for two different outcomes, which is the whole point of
      // routing per journey rather than per event type.
      await defineAction(tx, {
        journeyCode: 'MERCHANT',
        actionKey: 'activate',
        onOutcome: 'APPROVED',
        type: 'WEBHOOK',
        endpointId,
      });
      await defineAction(tx, {
        journeyCode: 'MERCHANT',
        actionKey: 'tell-compliance',
        onOutcome: 'IN_REVIEW',
        type: 'NOTIFY',
        channelId,
      });
    });
  });

  afterAll(async () => {
    await db.close();
  });

  const runCase = (subject: Record<string, unknown>, unn: string) =>
    withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const opened = await openCase(tx, { journeyCode: 'MERCHANT', clientRef: unn });
      return advanceCase(tx, {
        caseId: opened.caseId,
        subject,
        subjectIdentifiers: [{ idType: 'UNN', value: unn }],
        runStep: fixture.runnerFor(tx),
        keys,
      });
    });

  it('fires the action the outcome asks for, and queues it in the existing pipe', async () => {
    const { case: decided } = await runCase(SUBJECT, SUBJECT.unn);

    const fired = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listCaseActions(tx, decided.caseId),
    );
    expect(fired.length).toBeGreaterThan(0);

    // Whatever it decided, only the matching action fired.
    for (const entry of fired) {
      expect(entry.outcome).toBe(decided.status);
      expect(entry.deliveryId).toBeTruthy();
    }

    if (decided.status === 'APPROVED') {
      const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
        tx.query<{ event_type: string; payload: Record<string, unknown> }>(
          `SELECT event_type, payload FROM webhook_deliveries
           WHERE tenant_id = $1 AND event_type LIKE 'onboarding.%'
           ORDER BY created_at DESC LIMIT 1`,
          [tenant.tenantId],
        ),
      );
      expect(rows[0]?.event_type).toBe('onboarding.approved');
      expect(rows[0]?.payload['case_reference']).toBe(decided.reference);
    }
  });

  it('carries the file and never the applicant', async () => {
    const { case: decided } = await runCase(SUBJECT, SUBJECT.unn);

    const deliveries = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM webhook_deliveries WHERE tenant_id = $1
           AND event_type LIKE 'onboarding.%'`,
        [tenant.tenantId],
      ),
    );

    for (const row of deliveries.rows) {
      const serialised = JSON.stringify(row.payload);
      // Rule 4 and rule 5 reach the customer's own systems too: a webhook lands where we
      // have no control exactly as an email does.
      expect(serialised).not.toContain('7001272184');
      expect(serialised).not.toContain('1098765432');
      expect(serialised.toLowerCase()).not.toContain('stub');
    }
    expect(decided.reference).toMatch(/^ONB-/);
  });

  it('tells compliance when a file needs a person, and does not call the activation endpoint', async () => {
    // A provider having a bad afternoon: the required check fails and the file goes to a
    // person rather than to a rejection.
    const { case: decided } = await runCase({ unn: '7000000001' }, '7000000001');
    expect(decided.status).toBe('IN_REVIEW');

    const fired = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listCaseActions(tx, decided.caseId),
    );
    expect(fired.map((entry) => entry.actionKey)).toEqual(['tell-compliance']);
    expect(fired[0]?.actionType).toBe('NOTIFY');

    const notified = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ subject: string; body: string }>(
        `SELECT subject, body FROM notification_deliveries
         WHERE tenant_id = $1 AND event_type = 'onboarding.review'
         ORDER BY created_at DESC LIMIT 1`,
        [tenant.tenantId],
      ),
    );
    expect(notified.rows[0]?.subject).toContain('مراجعة');
    // The message is a pointer, here as everywhere.
    expect(notified.rows[0]?.body).not.toContain('7000000001');
  });

  it('records that nothing fired when nothing was configured', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      defineJourney(tx, {
        code: 'QUIET',
        nameAr: 'رحلة بلا إجراءات',
        steps: [{ stepKey: 'company', productCode: 'KYB_COMPLETE' }],
      }),
    );

    const decided = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const opened = await openCase(tx, { journeyCode: 'QUIET' });
      const result = await advanceCase(tx, {
        caseId: opened.caseId,
        subject: SUBJECT,
        subjectIdentifiers: [{ idType: 'UNN', value: SUBJECT.unn }],
        runStep: fixture.runnerFor(tx),
        keys,
      });
      return result.case;
    });

    const fired = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listCaseActions(tx, decided.caseId),
    );
    // "Why did their system never hear about this" has two answers, and only one is a bug.
    expect(fired).toEqual([]);
  });
});
