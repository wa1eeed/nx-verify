import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StaticMasterKeySource } from '../src/crypto/master-key.js';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  readableSecret,
  totpCode,
  totpStep,
  verifyTotp,
} from '../src/auth/totp.js';
import { openSecret, sealSecret } from '../src/crypto/secret-box.js';
import { qrSvg } from '../src/auth/qr.js';
import {
  createFirstOwner,
  createOperatorAccount,
  getOperatorAccount,
  setOperatorPassword,
  updateOperatorAccount,
  type OperatorIdentity,
} from '../src/operators/accounts.js';
import {
  confirmSecondFactorEnrolment,
  operatorHasSecondFactor,
  recoveryCodesLeft,
  resetSecondFactor,
  startSecondFactorEnrolment,
  verifyOperatorSecondFactor,
} from '../src/operators/second-factor.js';
import { listOperatorAudit } from '../src/operators/audit.js';
import { createTestDatabase, type TestDatabase } from '../../../test/helpers/db.js';

/**
 * The second factor of the administration panel (SEC-02), and the version that ends a session
 * the moment credentials change (SEC-04).
 *
 * The panel decides prices, sees every subscriber and moves balances. A password that leaks
 * must not open it, and a session opened before a password changed must not outlive it.
 */

const KEYS = new StaticMasterKeySource(Buffer.alloc(32, 9));
const NOW = new Date('2026-09-15T10:00:00Z');

describe('one time passwords', () => {
  it('encodes and decodes a secret the way an authenticator reads it', () => {
    const secret = generateTotpSecret();
    expect(secret).toHaveLength(20);
    expect(base32Decode(base32Encode(secret))).toEqual(secret);
    // Spaces and dashes are how a person types it in; both decode to the same bytes.
    expect(base32Decode(readableSecret(secret))).toEqual(secret);
  });

  it('computes the digits RFC 6238 fixes for a known secret', () => {
    // RFC 6238, appendix B: the SHA-1 vector's secret is «12345678901234567890».
    const secret = Buffer.from('12345678901234567890', 'utf8');
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1_111_111_109 / 30))).toBe('081804');
    expect(totpCode(secret, Math.floor(1_234_567_890 / 30))).toBe('005924');
  });

  it('accepts one step either side of now, and nothing further out', () => {
    const secret = generateTotpSecret();
    const step = totpStep(NOW);
    expect(verifyTotp(secret, totpCode(secret, step), { now: NOW })).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, step - 1), { now: NOW })).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step + 1), { now: NOW })).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), { now: NOW })).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step + 2), { now: NOW })).toBeNull();
    expect(verifyTotp(secret, '000', { now: NOW })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { now: NOW })).toBeNull();
  });

  it('refuses a step already used, which is what stops a code read over a shoulder', () => {
    const secret = generateTotpSecret();
    const step = totpStep(NOW);
    expect(verifyTotp(secret, totpCode(secret, step), { now: NOW, lastStep: step })).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step + 1), { now: NOW, lastStep: step })).toBe(
      step + 1,
    );
  });

  it('names the platform and the account in the address an authenticator scans', () => {
    const uri = otpauthUri({
      issuer: 'NX Trust',
      account: 'owner@nx.sa',
      secret: base32Decode('JBSWY3DPEHPK3PXP'),
    });
    expect(uri).toContain('otpauth://totp/NX%20Trust%3Aowner%40nx.sa');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
    // No data source is named anywhere a person can see (rule 5).
    expect(uri).not.toMatch(/lean/i);
  });

  it('draws the address as an SVG, with nothing fetched from anywhere', async () => {
    const svg = await qrSvg('otpauth://totp/NX%20Trust%3Aowner%40nx.sa?secret=JBSWY3DPEHPK3PXP');
    expect(svg.startsWith('<svg')).toBe(true);
    // Shapes only: no image, no link, no script. The secret never leaves the deployment.
    expect(svg).not.toMatch(/<(image|script|a)\b|href|src=/);
    expect(svg).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('seals a secret so it comes back exactly as it went in', () => {
    const key = Buffer.alloc(32, 3);
    const value = readableSecret(generateTotpSecret());
    const sealed = sealSecret(key, value);
    expect(sealed.toString('utf8')).not.toContain(value.slice(0, 4));
    expect(openSecret(key, sealed)).toBe(value);
    expect(() => openSecret(Buffer.alloc(32, 4), sealed)).toThrow();
    const torn = Buffer.from(sealed);
    torn.writeUInt8((torn.at(-1) ?? 0) ^ 1, torn.length - 1);
    expect(() => openSecret(key, torn)).toThrow();
  });
});

describe('the panel asks for a code as well as a password', () => {
  let db: TestDatabase;
  let owner: OperatorIdentity;
  let ownerId = '';
  let memberId = '';
  /** The authenticator's side of each enrolment: the same secret, read once when it is made. */
  const authenticators = new Map<string, Buffer>();
  const operator = () => db.operatorPool;

  const code = (accountId: string, at: Date = new Date()): string => {
    const secret = authenticators.get(accountId);
    if (secret === undefined) {
      throw new Error('this account has not started an enrolment');
    }
    return totpCode(secret, totpStep(at));
  };

  const start = async (accountId: string): Promise<string> => {
    const started = await startSecondFactorEnrolment(operator(), KEYS, accountId);
    authenticators.set(accountId, base32Decode(started.secret));
    return started.secret;
  };

  const enrol = async (accountId: string): Promise<string[]> => {
    await start(accountId);
    const { recoveryCodes } = await confirmSecondFactorEnrolment(
      operator(),
      KEYS,
      accountId,
      code(accountId),
    );
    return recoveryCodes;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    const first = await createFirstOwner(operator(), {
      email: 'owner@nx.sa',
      displayName: 'وليد الغامدي',
      password: 'a long enough passphrase',
    });
    ownerId = first.id;
    owner = { id: first.id, displayName: first.displayName, role: first.role };
    memberId = (
      await createOperatorAccount(operator(), owner, {
        email: 'support@nx.sa',
        displayName: 'دعم',
        role: 'SUPPORT',
        password: 'another long passphrase',
      })
    ).id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('starts an account with no authenticator, and credentials at version one', async () => {
    expect(await operatorHasSecondFactor(operator(), ownerId)).toBe(false);
    const account = await getOperatorAccount(operator(), ownerId);
    expect(account?.credentialVersion).toBe(1);
    expect(account?.secondFactorAt).toBeNull();
  });

  it('shows the same secret while an enrolment is unfinished', async () => {
    const first = await start(ownerId);
    const again = await startSecondFactorEnrolment(operator(), KEYS, ownerId);
    expect(again.secret).toBe(first);
    expect(again.uri).toContain('owner%40nx.sa');
    // Unconfirmed is not enrolled: a person who loses the phone halfway is not locked out.
    expect(await operatorHasSecondFactor(operator(), ownerId)).toBe(false);
  });

  it('keeps the secret out of the column that holds it', async () => {
    const { rows } = await operator().query<{ sealed: Buffer }>(
      `SELECT totp_secret_enc AS sealed FROM operator_accounts WHERE id = $1`,
      [ownerId],
    );
    const sealed = rows[0]?.sealed;
    expect(sealed).toBeInstanceOf(Buffer);
    const secret = base32Encode(authenticators.get(ownerId) as Buffer);
    expect(sealed?.toString('utf8')).not.toContain(secret.slice(0, 6));
    expect(sealed?.toString('base64')).not.toContain(secret.slice(0, 6));
  });

  it('refuses a wrong code, and finishes enrolment with a right one', async () => {
    await expect(
      confirmSecondFactorEnrolment(operator(), KEYS, ownerId, '000000'),
    ).rejects.toMatchObject({ code: 'NX-4011' });
    expect(await operatorHasSecondFactor(operator(), ownerId)).toBe(false);

    const { recoveryCodes } = await confirmSecondFactorEnrolment(
      operator(),
      KEYS,
      ownerId,
      code(ownerId),
    );
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(await operatorHasSecondFactor(operator(), ownerId)).toBe(true);
    expect((await getOperatorAccount(operator(), ownerId))?.secondFactorAt).not.toBeNull();
    // Enrolling again is refused: an authenticator is replaced by a reset, not by a second one.
    await expect(startSecondFactorEnrolment(operator(), KEYS, ownerId)).rejects.toMatchObject({
      code: 'NX-4091',
    });

    // The code that finished enrolment is spent: it cannot then open a sign in.
    const { rows } = await operator().query<{ step: string }>(
      `SELECT totp_last_step AS step FROM operator_accounts WHERE id = $1`,
      [ownerId],
    );
    const spent = Number(rows[0]?.step);
    const at = new Date(spent * 30_000);
    await expect(
      verifyOperatorSecondFactor(operator(), KEYS, ownerId, code(ownerId, at), at),
    ).rejects.toMatchObject({ code: 'NX-4011' });
  });

  it('keeps no recovery code in plain text', async () => {
    const { rows } = await operator().query<{
      codes: { hash: string; salt: string; used_at: string | null }[];
    }>(`SELECT recovery_codes AS codes FROM operator_accounts WHERE id = $1`, [ownerId]);
    expect(rows[0]?.codes).toHaveLength(10);
    for (const entry of rows[0]?.codes ?? []) {
      expect(entry.salt.length).toBeGreaterThan(0);
      expect(entry.used_at).toBeNull();
      // A recovery code is written in groups of four; a hash of one has no dashes in it.
      expect(entry.hash).not.toMatch(/-/);
    }
  });

  it('accepts a code once and refuses the same code a second time', async () => {
    // A step past the one enrolment finished with: that step is spent, as the next case shows.
    const at = new Date(Date.now() + 60_000);
    expect(await verifyOperatorSecondFactor(operator(), KEYS, ownerId, code(ownerId, at), at)).toBe(
      'CODE',
    );
    await expect(
      verifyOperatorSecondFactor(operator(), KEYS, ownerId, code(ownerId, at), at),
    ).rejects.toMatchObject({ code: 'NX-4011' });
    // The next step still works, so nobody is locked out for half a minute.
    const next = new Date(at.getTime() + 30_000);
    expect(
      await verifyOperatorSecondFactor(operator(), KEYS, ownerId, code(ownerId, next), next),
    ).toBe('CODE');
  });

  it('refuses a code for an account that has not enrolled', async () => {
    await expect(
      verifyOperatorSecondFactor(operator(), KEYS, memberId, '000000'),
    ).rejects.toMatchObject({ code: 'NX-4031' });
  });

  it('takes a recovery code once, and says so in the trail', async () => {
    const [first = '', second = ''] = await enrol(memberId);
    expect(await recoveryCodesLeft(operator(), memberId)).toBe(10);
    expect(await verifyOperatorSecondFactor(operator(), KEYS, memberId, first)).toBe('RECOVERY');
    expect(await recoveryCodesLeft(operator(), memberId)).toBe(9);
    await expect(
      verifyOperatorSecondFactor(operator(), KEYS, memberId, first),
    ).rejects.toMatchObject({ code: 'NX-4011' });
    // A code typed in lower case is the same code; only the one spent is gone.
    expect(await verifyOperatorSecondFactor(operator(), KEYS, memberId, second.toLowerCase())).toBe(
      'RECOVERY',
    );

    const trail = await listOperatorAudit(operator(), { actionPrefixes: ['staff.'] });
    const used = trail.filter((row) => row.action === 'staff.recovery_code_used');
    expect(used).toHaveLength(2);
    expect(used[0]?.metadata['remaining']).toBe(8);
    expect(trail.some((row) => row.action === 'staff.second_factor_enrolled')).toBe(true);
  });

  it('lets an owner take an authenticator off, and nobody else', async () => {
    const support: OperatorIdentity = { id: memberId, displayName: 'دعم', role: 'SUPPORT' };
    await expect(resetSecondFactor(operator(), support, ownerId)).rejects.toMatchObject({
      code: 'NX-4031',
    });

    const before = await getOperatorAccount(operator(), memberId);
    await resetSecondFactor(operator(), owner, memberId);
    const after = await getOperatorAccount(operator(), memberId);
    expect(await operatorHasSecondFactor(operator(), memberId)).toBe(false);
    expect(after?.secondFactorAt).toBeNull();
    expect(await recoveryCodesLeft(operator(), memberId)).toBe(0);
    // Their sessions fall with it (SEC-04).
    expect(after?.credentialVersion).toBe((before?.credentialVersion ?? 0) + 1);
    // A person may always take off their own, having lost the phone in their own hand.
    await enrol(memberId);
    await expect(resetSecondFactor(operator(), support, memberId)).resolves.toBeUndefined();
    expect(await operatorHasSecondFactor(operator(), memberId)).toBe(false);
  });

  it('raises the credential version on a password change and on a role change', async () => {
    const before = await getOperatorAccount(operator(), memberId);
    await setOperatorPassword(operator(), owner, memberId, 'a third long passphrase');
    const afterPassword = await getOperatorAccount(operator(), memberId);
    expect(afterPassword?.credentialVersion).toBe((before?.credentialVersion ?? 0) + 1);

    await updateOperatorAccount(operator(), owner, memberId, { role: 'READ_ONLY' });
    const afterRole = await getOperatorAccount(operator(), memberId);
    expect(afterRole?.credentialVersion).toBe((afterPassword?.credentialVersion ?? 0) + 1);
  });
});
