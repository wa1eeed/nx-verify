import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { applyProductSeed } from '../../../packages/db/src/seed/products.js';
import { enforceRetention, pruneInboundEvents } from '../src/jobs/retention.js';

/**
 * Unit 67 acceptance: the tables added since retention last changed do not grow for ever,
 * and the ones that must not be touched are not.
 *
 * The distinction is the point. A wait, a delivery and an expired link are operational
 * rows worth nothing once they have done their job. A top up request is a financial
 * record with a tax invoice on it, and money does not age out of relevance on an
 * operations schedule.
 */

describe('what retention reaches, and what it must not', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Retained Tenant');
    await withoutTenant(db.appPool, (tx) => applyProductSeed(tx));
    await db.operatorPool.query(
      `INSERT INTO provider_catalog (code, name_ar, name_en, endpoints)
       VALUES ('sweeper', 'كناس', 'Sweeper', '{cr/basic}')
       ON CONFLICT (code) DO NOTHING`,
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('clears provider callbacks that have done their job, and leaves recent ones', async () => {
    await withoutTenant(db.appPool, async (tx) => {
      await tx.query(
        `INSERT INTO inbound_events (provider, environment, event_type, external_id, body_digest,
                                     received_at)
         VALUES ('sweeper', 'live', 'x', 'old', 'd1', now() - interval '200 days'),
                ('sweeper', 'live', 'x', 'new', 'd2', now())`,
      );
    });

    const removed = await withoutTenant(db.retentionPool, (tx) => pruneInboundEvents(tx, 90));
    expect(removed).toBe(1);

    const { rows } = await withoutTenant(db.appPool, async (tx) => {
      const result = await tx.query<{ external_id: string }>(
        `SELECT external_id FROM inbound_events`,
      );
      return result;
    });
    expect(rows.map((row) => row.external_id)).toEqual(['new']);
  });

  it('never deletes a wait the provider might still answer', async () => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const run = await tx.query<{ id: string }>(
        `INSERT INTO verification_runs (tenant_id, product_code, mode_at_execution, status,
                                        triggered_by)
         SELECT $1, code, 'BYOC', 'AWAITING', 'API' FROM products LIMIT 1
         RETURNING id`,
        [tx.tenantId],
      );
      const runId = run.rows[0]?.id;
      expect(runId).toBeDefined();

      await tx.query(
        `INSERT INTO run_waits (tenant_id, run_id, step_key, provider, environment,
                                correlation_digest, subject_encrypted, expires_at,
                                status, resolved_at, created_at)
         VALUES ($1, $2, 'open', 'sweeper', 'live', 'digest-open', '\\x00'::bytea,
                 now() + interval '1 day', 'WAITING', NULL, now() - interval '400 days'),
                ($1, $2, 'done', 'sweeper', 'live', 'digest-done', '\\x00'::bytea,
                 now() - interval '300 days', 'RESUMED', now() - interval '300 days',
                 now() - interval '300 days')`,
        [tx.tenantId, runId],
      );
    });

    const summary = await withTenant(db.retentionPool, tenant.tenantId, (tx) =>
      enforceRetention(tx),
    );
    expect(summary.waitsPruned).toBe(1);

    const left = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const result = await tx.query<{ step_key: string }>(`SELECT step_key FROM run_waits`);
      return result.rows;
    });
    // Deleting an open wait leaves a run that can never be resumed and never closed.
    expect(left.map((row) => row.step_key)).toEqual(['open']);
  });

  it('clears finished verification requests and forgotten drafts, and never an open one', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(
        `INSERT INTO verification_requests (tenant_id, status, kind, subject_type, subject_hash,
                                            subject_enc, product_codes, bundle_key, created_at,
                                            submitted_at, completed_at)
         VALUES ($1, 'DONE', 'COMPANY', 'UNN', '\\x01'::bytea, '\\x01'::bytea, '{CR_FULL}',
                 'old-done-request', now() - interval '60 days', now() - interval '60 days',
                 now() - interval '60 days'),
                ($1, 'DRAFT', 'COMPANY', 'UNN', '\\x02'::bytea, '\\x02'::bytea, '{CR_FULL}',
                 'old-draft-request', now() - interval '120 days', NULL, NULL),
                ($1, 'DRAFT', 'COMPANY', 'UNN', '\\x03'::bytea, '\\x03'::bytea, '{CR_FULL}',
                 'new-draft-request', now() - interval '10 days', NULL, NULL),
                ($1, 'QUEUED', 'COMPANY', 'UNN', '\\x04'::bytea, '\\x04'::bytea, '{CR_FULL}',
                 'old-open-request', now() - interval '60 days', now() - interval '60 days', NULL)`,
        [tx.tenantId],
      ),
    );

    const summary = await withTenant(db.retentionPool, tenant.tenantId, (tx) =>
      enforceRetention(tx),
    );
    expect(summary.requestsPruned).toBe(2);

    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ bundle_key: string }>(
        `SELECT bundle_key FROM verification_requests ORDER BY bundle_key`,
      ),
    );
    expect(rows.map((row) => row.bundle_key)).toEqual(['new-draft-request', 'old-open-request']);
  });

  it('cannot touch a top up request at all', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(
        `INSERT INTO topup_requests (tenant_id, reference, amount, status, vat_invoice_id,
                                     settled_at, requested_at)
         VALUES ($1, 'TOP-2020-000001', 1000.00, 'CONFIRMED', 'INV-OLD',
                 now() - interval '900 days', now() - interval '900 days')`,
        [tx.tenantId],
      ),
    );

    // Not "is not deleted by the job" but "the role cannot delete it", which is the
    // stronger claim and the one a finance team would want.
    await expect(
      withTenant(db.retentionPool, tenant.tenantId, (tx) =>
        tx.query('DELETE FROM topup_requests WHERE tenant_id = $1', [tx.tenantId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    await withTenant(db.retentionPool, tenant.tenantId, (tx) => enforceRetention(tx));

    const { rows } = await withTenant(db.appPool, tenant.tenantId, async (tx) =>
      tx.query<{ reference: string }>(`SELECT reference FROM topup_requests`),
    );
    expect(rows).toHaveLength(1);
  });
});
