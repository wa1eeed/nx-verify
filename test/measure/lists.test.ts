import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../packages/db/src/client.js';
import {
  countCustomers,
  listCustomers,
  pickCustomers,
} from '../../packages/core/src/customers/list.js';
import { summarizeCustomers } from '../../packages/core/src/customers/summaries.js';
import { sweepStanding } from '../../packages/core/src/customers/standing.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../helpers/db.js';

/**
 * Rule 9: no optimisation before measurement. This is the measurement.
 *
 * The customers list is the screen a subscriber opens most, and it is built from the profile
 * view, which is itself a window function over every attestation. The question the rule asks is
 * whether that is a problem at the size a real subscriber reaches, and the only honest way to
 * answer it is with a number.
 *
 * It is skipped unless asked for, because seeding a million rows has no place in a suite that
 * runs on every commit:
 *
 *   NX_MEASURE=1 pnpm exec vitest run test/measure/lists.test.ts
 *
 * The figures it prints belong in docs/explanation/measurements.md. If they change, that file
 * changes with them.
 */

const asked = process.env['NX_MEASURE'] === '1';
const CUSTOMERS = Number(process.env['NX_MEASURE_CUSTOMERS'] ?? 50_000);
const FIELDS_EACH = Number(process.env['NX_MEASURE_FIELDS'] ?? 20);

describe.skipIf(!asked)('how the lists behave at size', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const keys = testKeys();
  const timings: { what: string; ms: number; rows: number }[] = [];

  const time = async <T>(what: string, run: () => Promise<T>): Promise<T> => {
    const started = process.hrtime.bigint();
    const result = await run();
    const ms = Number(process.hrtime.bigint() - started) / 1_000_000;
    timings.push({ what, ms, rows: Array.isArray(result) ? result.length : 1 });
    return result;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Measured Tenant');

    // Written in bulk rather than through the domain layer: what is being measured is the read,
    // and a million rows through the normalisation would take longer than the answer is worth.
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO entities (tenant_id, entity_type, display_name, first_seen_at, last_seen_at)
         SELECT $1,
                CASE WHEN i % 7 = 0 THEN 'FREELANCER' ELSE 'BUSINESS' END,
                'منشأة رقم ' || i,
                now() - make_interval(days => (i % 900)),
                now() - make_interval(days => (i % 900))
         FROM generate_series(1, $2) AS i`,
        [tenant.tenantId, CUSTOMERS],
      );

      // A product to hang the runs on. The catalogue is rows, and this measurement needs one.
      await tx.query(
        `INSERT INTO products (code, name_ar, name_en, subject_type, input_schema, module_code)
         VALUES ('MEASURE_PRODUCT', 'قياس', 'Measure', 'BUSINESS', '{"type":"object"}'::jsonb,
                 'REGISTRY')
         ON CONFLICT (code) DO NOTHING`,
      );

      await tx.query(
        `INSERT INTO verification_runs
           (tenant_id, product_code, entity_id, mode_at_execution, status, triggered_by, created_at)
         SELECT $1, 'MEASURE_PRODUCT', e.id, 'MANAGED', 'OK', 'API',
                now() - make_interval(days => (row_number() OVER ())::int % 900)
         FROM entities e WHERE e.tenant_id = $1`,
        [tenant.tenantId],
      );

      // One attestation per field per customer, observed across three years so freshness is a
      // real mixture rather than all fresh or all expired.
      await tx.query(
        `INSERT INTO attestations
           (tenant_id, entity_id, field_path, value, value_hash, source, authority, run_id,
            observed_at, valid_from)
         SELECT $1, e.id, f.path, to_jsonb(f.path || ':' || e.id::text),
                decode(md5(f.path || e.id::text), 'hex'), 'stub', 'الجهة',
                gen_random_uuid(),
                now() - make_interval(days => ((hashtext(e.id::text || f.path) % 900 + 900) % 900)),
                now() - make_interval(days => ((hashtext(e.id::text || f.path) % 900 + 900) % 900))
         FROM entities e
         CROSS JOIN LATERAL (
           SELECT CASE n
             WHEN 1 THEN 'cr.status' WHEN 2 THEN 'cr.kind' WHEN 3 THEN 'cr.status_code'
             WHEN 4 THEN 'cr.name' WHEN 5 THEN 'address.national'
             WHEN 6 THEN 'bank.iban_ownership' WHEN 7 THEN 'freelance.certificate_status'
             ELSE 'cr.field_' || n END AS path
           FROM generate_series(1, $2) AS n
         ) AS f
         WHERE e.tenant_id = $1`,
        [tenant.tenantId, FIELDS_EACH],
      );

      // One row per customer, as migration 0053 backfills it on a real deployment. The two
      // columns the list navigates by are read from the answers; the two the model decides are
      // spread deterministically, because what is measured is the read and not the sweep.
      await tx.query(
        `INSERT INTO customer_standing
           (tenant_id, entity_id, kind, last_verified_at, completeness, open_alerts, computed_at)
         SELECT $1, e.id,
                CASE WHEN e.entity_type = 'FREELANCER' THEN 'FREELANCER'
                     WHEN (hashtext(e.id::text) % 2) = 0 THEN 'COMPANY'
                     ELSE 'ESTABLISHMENT' END,
                (SELECT max(a.observed_at) FROM attestations a
                  WHERE a.tenant_id = $1 AND a.entity_id = e.id),
                ((hashtext(e.id::text || 'c') % 101 + 101) % 101),
                ((hashtext(e.id::text || 'a') % 4 + 4) % 4),
                now()
           FROM entities e
          WHERE e.tenant_id = $1
         ON CONFLICT (tenant_id, entity_id) DO NOTHING`,
        [tenant.tenantId],
      );

      await tx.query(`ANALYZE`);
    });
  }, 900_000);

  afterAll(async () => {
    if (timings.length > 0) {
      const total = (await import('node:util')).format;
      // The error stream, because it is the one this repository allows and a measurement is
      // output rather than a log.
      console.error('\n| what | rows | ms |');
      console.error('| --- | ---: | ---: |');
      for (const entry of timings) {
        console.error(total('| %s | %d | %s |', entry.what, entry.rows, entry.ms.toFixed(0)));
      }
    }
    await db?.close();
  });

  it('opens the customers list', async () => {
    const rows = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      time(`customers list, first 100 of ${CUSTOMERS}`, () =>
        listCustomers(tx, keys, { limit: 100 }),
      ),
    );
    expect(rows.length).toBe(100);
  }, 600_000);

  it('opens the page the screen actually asks for', async () => {
    // What the console does now: choose twenty five, then summarise those twenty five.
    const picked = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      time('page of 25, chosen', () => pickCustomers(tx, keys, { limit: 25 })),
    );
    expect(picked.entityIds.length).toBe(25);
    expect(picked.total).toBeGreaterThan(0);

    const rows = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      time('page of 25, summarised', () =>
        summarizeCustomers(tx, keys, { entityIds: picked.entityIds }),
      ),
    );
    expect(rows.length).toBe(25);
  }, 600_000);

  it('asks the profile view for a page, both ways', async () => {
    // The awkward question: `entity_id = ANY(array)` is one qual over the whole view, and a
    // LATERAL over the ids is a parameterised one. Neither is obviously pushed down, so both
    // are timed here in the same process against the same data rather than argued about.
    const ids = (
      await withTenant(db.appPool, tenant.tenantId, (tx) => pickCustomers(tx, keys, { limit: 25 }))
    ).entityIds;

    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await time(
        'profile of 25, by array',
        async () =>
          (
            await tx.query(
              `SELECT entity_id, field_path, value, observed_at, freshness FROM entity_profile
                WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[])`,
              [tenant.tenantId, ids],
            )
          ).rows,
      );
      await time('profile of 25, one query each', async () => {
        let rows = 0;
        for (const id of ids) {
          rows += (
            await tx.query(
              `SELECT entity_id, field_path, value, observed_at, freshness FROM entity_profile
                  WHERE tenant_id = $1 AND entity_id = $2`,
              [tenant.tenantId, id],
            )
          ).rows.length;
        }
        return new Array(rows);
      });
    });
  }, 600_000);

  it('counts the facets beside the filters', async () => {
    const counts = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      time('facet counts', () => countCustomers(tx)),
    );
    expect(counts.all).toBeGreaterThan(0);
  }, 600_000);

  it('sweeps a batch of standing rows', async () => {
    const swept = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      // Stamped first, because the sweep is meant to find work rather than make it: what is
      // timed is recomputing two hundred customers, not deciding there are none.
      await tx.query(
        `UPDATE customer_standing SET stale_at = now()
          WHERE tenant_id = $1 AND entity_id IN (
            SELECT entity_id FROM customer_standing WHERE tenant_id = $1 LIMIT 200)`,
        [tenant.tenantId],
      );
      return time('standing sweep, 200 customers', () => sweepStanding(tx, keys, { batch: 200 }));
    });
    expect(swept.refreshed).toBe(200);
  }, 600_000);

  it('opens it filtered by kind', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      time('customers list, freelancers only', () =>
        listCustomers(tx, keys, { limit: 100, kind: 'FREELANCER' }),
      ),
    );
  }, 600_000);

  it('searches it by name', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      time('customers list, name search', () =>
        listCustomers(tx, keys, { limit: 100, search: 'منشأة رقم 4242' }),
      ),
    );
  }, 600_000);

  it('summarises the whole workspace', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      time('workspace summary, first 100', () => summarizeCustomers(tx, keys, { limit: 100 })),
    );
  }, 600_000);

  it('reads one customer file out of the middle', async () => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM entities WHERE tenant_id = $1 ORDER BY first_seen_at OFFSET $2 LIMIT 1`,
        [tenant.tenantId, Math.floor(CUSTOMERS / 2)],
      );
      const id = rows[0]?.id as string;
      await time(
        'one profile, every field',
        async () =>
          (
            await tx.query(
              `SELECT field_path, value, freshness FROM entity_profile
             WHERE tenant_id = $1 AND entity_id = $2`,
              [tenant.tenantId, id],
            )
          ).rows,
      );
    });
  }, 600_000);
});
