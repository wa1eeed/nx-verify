import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { advanceCase, defineJourney, openCase } from '../src/onboarding/cases.js';
import { defineAction, listCaseActions } from '../src/onboarding/actions.js';
import { registerEndpoint } from '../src/webhooks/dispatch.js';
import { addChannel, subscribe } from '../src/notifications/notifications.js';
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
    // The file is decided and carries no verdict: this is the common road to review, and
    // a screen that asks `outcome` whether a decision was reached gets the wrong answer.
    expect(decided.outcome).toBeNull();

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

  it('fires the outcome once, and not again when the same conclusion is reached twice', async () => {
    // A file in review does not close, so running its checks again concludes it again. The
    // conclusion is the same one, and a second copy of it in the customer's CRM is a second
    // merchant to look at.
    const { case: reviewed } = await runCase({ unn: '7000000001' }, '7000000001');
    expect(reviewed.status).toBe('IN_REVIEW');

    const first = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listCaseActions(tx, reviewed.caseId),
    );
    expect(first).toHaveLength(1);

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      advanceCase(tx, {
        caseId: reviewed.caseId,
        subject: { unn: '7000000001' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7000000001' }],
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

    const second = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listCaseActions(tx, reviewed.caseId),
    );
    expect(second).toHaveLength(1);
  });

  it('records that nothing fired when nothing was configured and nobody subscribed', async () => {
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

  /**
   * The default route (ADR-182).
   *
   * These run after the ones above on purpose: until this point the tenant subscribes to
   * nothing onboarding, which is the state the test above pins down. From here it
   * subscribes, on the two surfaces a subscriber actually has, and the decision has to
   * reach them without anybody writing a `case_actions` row, because no screen writes one.
   */
  describe('a journey nobody routed', () => {
    let subscribedEndpoint = '';

    beforeAll(async () => {
      await withTenant(db.appPool, tenant.tenantId, async (tx) => {
        // Every onboarding outcome, on both surfaces, because what this tenant's ruleset
        // makes of a given applicant is not the property under test.
        subscribedEndpoint = await registerEndpoint(tx, {
          url: 'https://customer.example/onboarding',
          secretRef: 'kms://tenants/acting/onboarding',
          events: ['onboarding.approved', 'onboarding.rejected', 'onboarding.review'],
        });
        for (const eventType of [
          'onboarding.approved',
          'onboarding.rejected',
          'onboarding.review',
        ] as const) {
          await subscribe(tx, { channelId, eventType });
        }
        await defineJourney(tx, {
          code: 'UNROUTED',
          nameAr: 'رحلة بلا توجيه',
          steps: [{ stepKey: 'company', productCode: 'KYB_COMPLETE' }],
        });
      });
    });

    it('goes where the subscriber already said this event goes', async () => {
      const decided = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
        const opened = await openCase(tx, { journeyCode: 'UNROUTED', clientRef: 'SUB-1' });
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
      // The customer's machine and the customer's people, each from its own subscription,
      // with no row in `case_actions` anywhere: no screen writes one.
      expect(fired.map((entry) => entry.actionType).sort()).toEqual(['NOTIFY', 'WEBHOOK']);
      for (const entry of fired) {
        expect(entry.actionKey).toBe('subscription');
        expect(entry.outcome).toBe(decided.status);
        expect(entry.deliveryId).toBeTruthy();
      }

      const webhook = fired.find((entry) => entry.actionType === 'WEBHOOK');
      const delivered = await withTenant(db.appPool, tenant.tenantId, (tx) =>
        tx.query<{ endpoint_id: string; event_type: string; payload: Record<string, unknown> }>(
          `SELECT endpoint_id, event_type, payload FROM webhook_deliveries
           WHERE tenant_id = $1 AND id = $2`,
          [tenant.tenantId, webhook?.deliveryId],
        ),
      );
      expect(delivered.rows[0]?.endpoint_id).toBe(subscribedEndpoint);
      expect(delivered.rows[0]?.payload['client_ref']).toBe('SUB-1');
      // The file, never the applicant, on this route as on the other one.
      expect(JSON.stringify(delivered.rows[0]?.payload)).not.toContain(SUBJECT.unn);

      const message = fired.find((entry) => entry.actionType === 'NOTIFY');
      const messages = await withTenant(db.appPool, tenant.tenantId, (tx) =>
        tx.query<{ channel_id: string; body: string }>(
          `SELECT channel_id, body FROM notification_deliveries
           WHERE tenant_id = $1 AND id = $2`,
          [tenant.tenantId, message?.deliveryId],
        ),
      );
      expect(messages.rows[0]?.channel_id).toBe(channelId);
      expect(messages.rows[0]?.body).not.toContain(SUBJECT.unn);
    });

    it('is overruled by a journey that names its own targets, and nobody else hears', async () => {
      const decided = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
        const opened = await openCase(tx, { journeyCode: 'MERCHANT', clientRef: 'SUB-2' });
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
      // "On approval call our activation endpoint, and nobody else" has to be able to mean
      // nobody else, the subscriptions included.
      expect(fired.every((entry) => entry.actionKey !== 'subscription')).toBe(true);

      const delivered = await withTenant(db.appPool, tenant.tenantId, (tx) =>
        tx.query<{ endpoint_id: string }>(
          `SELECT endpoint_id FROM webhook_deliveries
           WHERE tenant_id = $1 AND payload->>'client_ref' = 'SUB-2'`,
          [tenant.tenantId],
        ),
      );
      expect(delivered.rows.map((row) => row.endpoint_id)).not.toContain(subscribedEndpoint);
    });

    it('sends an outcome a routed journey does name to that target alone', async () => {
      // MERCHANT names a target for IN_REVIEW, and the endpoint now subscribed to every
      // onboarding event must not arrive beside it.
      const { case: reviewed } = await runCase({ unn: '7000000001' }, '7000000001');
      expect(reviewed.status).toBe('IN_REVIEW');

      const fired = await withTenant(db.appPool, tenant.tenantId, (tx) =>
        listCaseActions(tx, reviewed.caseId),
      );
      expect(fired.map((entry) => entry.actionKey)).toEqual(['tell-compliance']);
    });

    it('fires nothing for an outcome a routed journey does not name', async () => {
      // The property the narrowing exists for, and the one the test above does not reach:
      // a journey that routes approval and says nothing about review. A file that goes to
      // review has to fire nothing at all, subscriptions included, or "and nobody else"
      // stops meaning that the moment somebody ticks a box on the webhooks screen.
      await withTenant(db.appPool, tenant.tenantId, async (tx) => {
        await defineJourney(tx, {
          code: 'NARROW',
          nameAr: 'رحلة تُوجّه القبول وحده',
          steps: [{ stepKey: 'company', productCode: 'KYB_COMPLETE' }],
        });
        await defineAction(tx, {
          journeyCode: 'NARROW',
          actionKey: 'activate-only',
          onOutcome: 'APPROVED',
          type: 'WEBHOOK',
          endpointId,
        });
      });

      const reviewed = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
        const opened = await openCase(tx, { journeyCode: 'NARROW', clientRef: 'SUB-3' });
        const result = await advanceCase(tx, {
          caseId: opened.caseId,
          subject: { unn: '7000000001' },
          subjectIdentifiers: [{ idType: 'UNN', value: '7000000001' }],
          runStep: fixture.runnerFor(tx),
          keys,
        });
        return result.case;
      });
      expect(reviewed.status).toBe('IN_REVIEW');

      const fired = await withTenant(db.appPool, tenant.tenantId, (tx) =>
        listCaseActions(tx, reviewed.caseId),
      );
      expect(fired).toEqual([]);

      const delivered = await withTenant(db.appPool, tenant.tenantId, (tx) =>
        tx.query<{ id: string }>(
          `SELECT id FROM webhook_deliveries
           WHERE tenant_id = $1 AND payload->>'client_ref' = 'SUB-3'`,
          [tenant.tenantId],
        ),
      );
      expect(delivered.rows).toEqual([]);
    });
  });
});
