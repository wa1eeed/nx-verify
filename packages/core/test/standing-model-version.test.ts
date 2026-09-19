import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { countCustomers } from '../src/customers/list.js';
import { riskModelVersion } from '../src/customers/risk-policy.js';
import { refreshStanding, sweepStanding } from '../src/customers/standing.js';
import {
  createTestDatabase,
  insertAttestation,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';

/**
 * A standing row knows which risk model computed it (ADR-175, migration 0067).
 *
 * The hole 0066 wrote down: a customer changing stamps the row, and the risk model changing
 * stamps nothing, because the panel edits on a connection this table has no policy for and
 * giving it one would open a write across subscribers on the table that holds their customers.
 *
 * So the row records the model and staleness is read. What is proven here is that the answer
 * arrives the instant the model moves, with no sweep in between, with nothing written to say
 * so, and with one subscriber's disagreement moving their model and nobody else's.
 */

describe('standing rows know the risk model that computed them', () => {
  let db: TestDatabase;
  let alpha: SeededTenant;
  let beta: SeededTenant;
  const keys = testKeys();

  const inTenant = <T>(
    tenant: SeededTenant,
    work: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<T>,
  ): Promise<T> => withTenant(db.appPool, tenant.tenantId, work);

  /** The model in force for this subscriber, read on their own connection. */
  const modelOf = (tenant: SeededTenant): Promise<string | null> =>
    inTenant(tenant, (tx) => riskModelVersion(tx));

  /** What their standing rows say made them, and when each was computed. */
  const rowsOf = (
    tenant: SeededTenant,
  ): Promise<
    {
      entity_id: string;
      risk_model_version: string | null;
      risk_score: number | null;
      computed_at: Date;
    }[]
  > =>
    inTenant(tenant, async (tx) => {
      const { rows } = await tx.query<{
        entity_id: string;
        risk_model_version: string | null;
        risk_score: number | null;
        computed_at: Date;
      }>(
        `SELECT entity_id, risk_model_version, risk_score, computed_at FROM customer_standing
          WHERE tenant_id = $1 ORDER BY entity_id`,
        [tx.tenantId],
      );
      return rows;
    });

  const behind = (tenant: SeededTenant): Promise<number> =>
    inTenant(tenant, async (tx) => (await countCustomers(tx)).underOlderModel);

  beforeAll(async () => {
    db = await createTestDatabase();
    alpha = await seedTenant(db.appPool, 'Alpha');
    beta = await seedTenant(db.appPool, 'Beta');
    await insertAttestation(db.appPool, alpha, { fieldPath: 'cr.status' });
    await insertAttestation(db.appPool, beta, { fieldPath: 'cr.status' });
    await inTenant(alpha, (tx) => refreshStanding(tx, keys, [alpha.entityId]));
    await inTenant(beta, (tx) => refreshStanding(tx, keys, [beta.entityId]));
  });

  afterAll(async () => {
    await db.close();
  });

  it('writes the model that computed the row, and reads it back as current', async () => {
    const [rows, model] = [await rowsOf(alpha), await modelOf(alpha)];
    expect(model).not.toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.risk_model_version).toBe(model);
    expect(await behind(alpha)).toBe(0);
  });

  it('does not count a row that recorded no model as one computed under an older model', async () => {
    // A row stamped when somebody was verified has not been computed since, so no model was
    // written down for it. The sweep claims it anyway; the screen says nothing about it,
    // because «the model changed after this was computed» is not something we know here.
    const unrated = await inTenant(alpha, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO entities (tenant_id, entity_type, display_name)
         VALUES ($1, 'BUSINESS', 'Unrated') RETURNING id`,
        [tx.tenantId],
      );
      const id = rows[0]?.id ?? '';
      await tx.query(
        `INSERT INTO customer_standing (tenant_id, entity_id, stale_at) VALUES ($1, $2, now())`,
        [tx.tenantId, id],
      );
      return id;
    });
    expect(await behind(alpha)).toBe(0);

    // The sweep is free to be suspicious about it, and is.
    await inTenant(alpha, (tx) => sweepStanding(tx, keys, { batch: 10, maxAgeMinutes: 60 }));
    const swept = (await rowsOf(alpha)).find((row) => row.entity_id === unrated);
    expect(swept?.risk_model_version).toBe(await modelOf(alpha));

    await inTenant(alpha, (tx) =>
      tx.query(`DELETE FROM customer_standing WHERE tenant_id = $1 AND entity_id = $2`, [
        tx.tenantId,
        unrated,
      ]),
    );
  });

  it('reads the row as old the instant the platform model moves, with no sweep and no write', async () => {
    const before = await rowsOf(alpha);
    const wasAlpha = await modelOf(alpha);

    // The panel's own connection, editing the model and nothing else.
    await db.operatorPool.query(
      `UPDATE risk_signals SET weight = weight - 5, updated_at = now() WHERE code = $1`,
      ['liquidation'],
    );

    // No worker has run and nothing has been written to any subscriber's table.
    const after = await rowsOf(alpha);
    expect(after[0]?.computed_at.getTime()).toBe(before[0]?.computed_at.getTime());
    expect(after[0]?.risk_model_version).toBe(before[0]?.risk_model_version);

    // And yet the answer is already there, in the subscriber's own query.
    expect(await modelOf(alpha)).not.toBe(wasAlpha);
    expect(await behind(alpha)).toBe(1);
    expect(await behind(beta)).toBe(1);
  });

  it('reads the model as whoever called it, so no subscriber can be told about another', async () => {
    const { rows } = await db.migratorPool.query<{ prosecdef: boolean }>(
      `SELECT p.prosecdef FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app' AND p.proname = 'risk_model_version'`,
    );
    expect(rows).toHaveLength(1);
    // SECURITY DEFINER would run this as the owner, and the overrides it reads would be every
    // subscriber's rather than the caller's. The whole isolation of the answer rests on this.
    expect(rows[0]?.prosecdef).toBe(false);
  });

  it('is executable by the subscriber role alone, because it is only isolated for that one', async () => {
    // SECURITY INVOKER keeps the answer honest only for a caller whose policy is `t_isolation`.
    // `tenant_risk_signals` carries a second policy, `operator_manage`, reading USING (true), so
    // the same function called on the panel's connection would fold every subscriber's overrides
    // into one value. Postgres grants EXECUTE to PUBLIC by default, which would have left that
    // door open to a role that must never be told what another subscriber's model is.
    const { rows } = await db.migratorPool.query<{ op: boolean; ret: boolean; app: boolean }>(
      `SELECT has_function_privilege('nx_operator', 'app.risk_model_version()', 'EXECUTE') AS op,
              has_function_privilege('nx_retention', 'app.risk_model_version()', 'EXECUTE') AS ret,
              has_function_privilege('nx_app', 'app.risk_model_version()', 'EXECUTE') AS app`,
    );
    expect(rows[0]).toEqual({ op: false, ret: false, app: true });
    await expect(db.operatorPool.query(`SELECT app.risk_model_version()`)).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('refuses the shortcut this design exists to avoid: staff cannot write the table', async () => {
    // The repair that was not taken. nx_operator holds no grant on customer_standing, so the
    // stamping that would have made a model change immediate is not merely unused, it is
    // impossible, and rule 2 stays shut on the table that holds subscribers' customers.
    await expect(
      db.operatorPool.query(`UPDATE customer_standing SET stale_at = now()`),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('is claimed by the next sweep without waiting for the row to age out', async () => {
    // The row was computed moments ago, so the hour long age rule cannot be what claims it.
    const swept = await inTenant(alpha, (tx) =>
      sweepStanding(tx, keys, { batch: 10, maxAgeMinutes: 60 }),
    );
    expect(swept.refreshed).toBe(1);
    expect(await behind(alpha)).toBe(0);
    expect((await rowsOf(alpha))[0]?.risk_model_version).toBe(await modelOf(alpha));

    // Beta was not touched by alpha's sweep: it is still behind, on its own connection.
    expect(await behind(beta)).toBe(1);
    await inTenant(beta, (tx) => sweepStanding(tx, keys, { batch: 10, maxAgeMinutes: 60 }));
    expect(await behind(beta)).toBe(0);
  });

  it('moves one subscriber model without moving anybody else', async () => {
    const alphaModel = await modelOf(alpha);
    const betaModel = await modelOf(beta);
    expect(betaModel).toBe(alphaModel);

    // Beta disagrees with one weight. Staff write it, on the tables guard 02 allows them.
    await db.operatorPool.query(
      `INSERT INTO tenant_risk_signals (tenant_id, signal_code, weight) VALUES ($1, $2, $3)`,
      [beta.tenantId, 'shared_address', 20],
    );

    expect(await modelOf(beta)).not.toBe(betaModel);
    expect(await modelOf(alpha)).toBe(alphaModel);
    expect(await behind(beta)).toBe(1);
    // The reason a counter was refused: one subscriber's edit must not mark another's rows
    // old, because a screen that says that is saying something untrue.
    expect(await behind(alpha)).toBe(0);
  });

  it('returns a row to current when the disagreement is lifted, because the model returned', async () => {
    await db.operatorPool.query(
      `DELETE FROM tenant_risk_signals WHERE tenant_id = $1 AND signal_code = $2`,
      [beta.tenantId, 'shared_address'],
    );
    // Beta's row was never recomputed under the override. The model is the one that made it
    // again, so the row is current again, which a monotonic counter could not have said.
    expect(await behind(beta)).toBe(0);
    expect((await rowsOf(beta))[0]?.risk_model_version).toBe(await modelOf(beta));
  });

  it('leaves the bands out, because no stored row was computed under them', async () => {
    const before = await modelOf(alpha);
    await db.operatorPool.query(`UPDATE platform_settings SET risk_high_from = risk_high_from - 1`);
    // «عالية» is decided when a score is read, so moving the line moves the facet at once and
    // recomputes nothing. A model version that included it would recompute every customer to
    // arrive at the number each already holds.
    expect(await modelOf(alpha)).toBe(before);
    expect(await behind(alpha)).toBe(0);
  });
  // Last, because it takes the column away and puts it back.
  it('rolls back and reapplies, so the migration can be undone on a deployment that has it', async () => {
    const dir = new URL('../../db/migrations/', import.meta.url).pathname;
    const run = async (file: string): Promise<void> => {
      const client = await db.migratorPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    };

    await run('0067_standing_knows_its_model.down.sql');
    await expect(
      db.migratorPool.query(`SELECT risk_model_version FROM customer_standing`),
    ).rejects.toMatchObject({ code: '42703' });
    await expect(db.migratorPool.query(`SELECT app.risk_model_version()`)).rejects.toMatchObject({
      code: '42883',
    });

    await run('0067_standing_knows_its_model.up.sql');
    expect(await modelOf(alpha)).not.toBeNull();
    // And every row is back to recording nothing, which reads as a row the sweep will claim.
    expect((await rowsOf(alpha))[0]?.risk_model_version).toBeNull();
  });
});
