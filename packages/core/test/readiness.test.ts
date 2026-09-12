import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../test/helpers/db.js';
import { checkReadiness, type ReadinessCheck } from '../src/ops/readiness.js';

/**
 * Unit 66 acceptance: the install guide, asked of the running system.
 *
 * The property under test is not that the checks pass. It is that a deployment which is
 * not ready says so, and says the exact thing to set: a red row with no remedy on it is a
 * red row somebody learns to scroll past.
 */

const PRODUCTION = {
  NODE_ENV: 'production',
  NX_PUBLIC_BASE_URL: 'https://api.nx.sa',
  NX_CONSOLE_BASE_URL: 'https://app.nx.sa',
  NX_SECRETS_ENDPOINT: 'https://secrets.nx.sa',
  NX_KMS_ENDPOINT: 'https://kms.nx.sa',
  NX_MAIL_ENDPOINT: 'https://mail.nx.sa',
  NX_MAIL_TOKEN: 'token',
  NX_MAIL_FROM: 'no-reply@nx.sa',
  NX_BANK_IBAN: 'SA0000000000000000000000',
  NX_BANK_ACCOUNT_NAME: 'NX',
  NX_OPERATOR_TOKEN: 'x'.repeat(40),
};

const find = (checks: ReadinessCheck[], id: string): ReadinessCheck => {
  const check = checks.find((candidate) => candidate.id === id);
  if (!check) {
    throw new Error(`no check called ${id}`);
  }
  return check;
};

describe('deployment readiness', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  const run = (env: Record<string, string | undefined>, secretsWritable = true) =>
    checkReadiness(db.operatorPool, {
      env,
      secretsWritable,
      migrations: { defined: 10, applied: 10 },
    });

  it('gives every failing check something to actually do', async () => {
    const report = await run({});
    const failing = report.checks.filter((check) => check.state !== 'ok');
    expect(failing.length).toBeGreaterThan(0);
    for (const check of failing) {
      expect(check.fixAr, `${check.id} says nothing to set`).toBeTruthy();
    }
    // And a passing check offers no remedy, because there is nothing to change.
    for (const check of report.checks.filter((check) => check.state === 'ok')) {
      expect(check.fixAr).toBeNull();
    }
  });

  it('blocks on the environment store and the environment key in production', async () => {
    const report = await run({
      ...PRODUCTION,
      NX_SECRETS_ENDPOINT: undefined,
      NX_KMS_ENDPOINT: undefined,
    });
    expect(find(report.checks, 'secrets').state).toBe('blocked');
    expect(find(report.checks, 'keys').state).toBe('blocked');
    expect(report.canServeLive).toBe(false);
  });

  it('warns rather than blocks on the same two in development', async () => {
    const report = await run({ ...PRODUCTION, NODE_ENV: 'development', NX_SECRETS_ENDPOINT: undefined, NX_KMS_ENDPOINT: undefined });
    expect(find(report.checks, 'secrets').state).toBe('warn');
    expect(find(report.checks, 'keys').state).toBe('warn');
  });

  it('treats an unapplied migration as a stop', async () => {
    const report = await checkReadiness(db.operatorPool, {
      env: PRODUCTION,
      secretsWritable: true,
      migrations: { defined: 12, applied: 9 },
    });
    expect(find(report.checks, 'migrations').state).toBe('blocked');
    expect(find(report.checks, 'migrations').fixAr).toContain('migrate');
  });

  it('will not call a production environment ready with no provider connected', async () => {
    const report = await run(PRODUCTION);
    expect(find(report.checks, 'connections.live').state).toBe('blocked');
    // A sandbox nobody can try is a warning, not a stop.
    expect(find(report.checks, 'connections.sandbox').state).toBe('warn');
  });

  it('refuses a connection that names no credential', async () => {
    await db.operatorPool.query(
      `INSERT INTO provider_catalog (code, name_ar, name_en, endpoints)
       VALUES ('bank', 'مصرفي', 'Bank', '{iban/ownership}')
       ON CONFLICT (code) DO NOTHING`,
    );
    await db.operatorPool.query(
      `INSERT INTO provider_connections (provider, environment, kind, base_url)
       VALUES ('bank', 'live', 'http', 'https://api.example.com')
       ON CONFLICT (provider, environment) DO NOTHING`,
    );

    const report = await run(PRODUCTION);
    const live = find(report.checks, 'connections.live');
    expect(live.state).toBe('blocked');
    expect(live.detailAr).toContain('بلا مرجع اعتماد');

    // And a stub needs none, so it does not count against the environment.
    await db.operatorPool.query(
      `UPDATE provider_connections SET kind = 'stub', base_url = NULL
       WHERE provider = 'bank' AND environment = 'live'`,
    );
    const after = await run(PRODUCTION);
    expect(find(after.checks, 'connections.live').state).toBe('ok');
  });

  it('treats a short operator token as a stop, and a merely weak one as a warning', async () => {
    const short = await run({ ...PRODUCTION, NX_OPERATOR_TOKEN: 'too-short' });
    expect(find(short.checks, 'operator_token').state).toBe('blocked');

    const weak = await run({ ...PRODUCTION, NX_OPERATOR_TOKEN: 'y'.repeat(26) });
    expect(find(weak.checks, 'operator_token').state).toBe('warn');
  });

  it('does not stop a deployment over mail or bank details', async () => {
    const report = await run({
      ...PRODUCTION,
      NX_MAIL_ENDPOINT: undefined,
      NX_BANK_IBAN: undefined,
    });
    // Nothing is lost when mail is unset: the queue holds. The customer simply is not
    // told, and that is a warning rather than a stop.
    expect(find(report.checks, 'mail').state).toBe('warn');
    expect(find(report.checks, 'bank').state).toBe('warn');
  });

  it('reads configuration and never a subscriber', async () => {
    // The whole screen runs on the operator connection, which has no policy on any table
    // holding a subscriber's own data. If a check ever reached for one it would fail here
    // rather than in front of a customer.
    await expect(
      db.operatorPool.query('SELECT count(*) FROM attestations'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(db.operatorPool.query('SELECT count(*) FROM entities')).rejects.toMatchObject({
      code: '42501',
    });
  });
});
