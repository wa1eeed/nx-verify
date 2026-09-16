import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Time based one time passwords, as RFC 6238 defines them (SEC-02).
 *
 * The panel decides prices, sees every subscriber and moves balances, so a password alone is
 * not enough to open it. A second factor is the cheapest real defence against a password that
 * leaks, and the standard one every authenticator application already speaks: a shared secret,
 * a thirty second step, six digits, HMAC-SHA1 as the specification fixes it.
 *
 * Written here rather than taken from a library: it is forty lines of the standard, and an
 * authentication dependency is a supply chain risk that has to be justified (SEC-01, SEC-05).
 *
 * A code is accepted one step either side of now, which covers a clock a little behind or
 * ahead, and never twice: the step it matched is returned so the caller can refuse a replay.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
/** One step either side: half a minute of clock drift, no more. */
const WINDOW = 1;
const SECRET_BYTES = 20;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding, which is what an authenticator reads. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(value: string): Buffer {
  const cleaned = value.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let carry = 0;
  const bytes: number[] = [];
  for (const character of cleaned) {
    const index = BASE32.indexOf(character);
    if (index === -1) {
      throw new Error('the secret is not base32');
    }
    carry = (carry << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((carry >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A fresh secret: 160 bits, the size the specification recommends for HMAC-SHA1. */
export function generateTotpSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

/** Which step a moment falls in. */
export function totpStep(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000 / STEP_SECONDS);
}

/** The six digits of one step, as an authenticator computes them. */
export function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', secret).update(counter).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    (((digest[offset + 1] as number) & 0xff) << 16) |
    (((digest[offset + 2] as number) & 0xff) << 8) |
    ((digest[offset + 3] as number) & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * The step a code is right for, or null.
 *
 * Compared in constant time, and only against steps after the last one this account used, so a
 * code seen by somebody watching the screen cannot be used again.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  options: { now?: Date; lastStep?: number | null } = {},
): number | null {
  const digits = code.replace(/\D/g, '');
  if (digits.length !== DIGITS) {
    return null;
  }
  const current = totpStep(options.now ?? new Date());
  const presented = Buffer.from(digits, 'utf8');
  for (let offset = -WINDOW; offset <= WINDOW; offset += 1) {
    const step = current + offset;
    if (options.lastStep !== undefined && options.lastStep !== null && step <= options.lastStep) {
      continue;
    }
    const expected = Buffer.from(totpCode(secret, step), 'utf8');
    if (expected.length === presented.length && timingSafeEqual(expected, presented)) {
      return step;
    }
  }
  return null;
}

/**
 * The address an authenticator reads from a QR code.
 *
 * The label carries the account so a person with several can tell them apart, and the issuer
 * is the platform rather than the deployment's host name, which changes.
 */
export function otpauthUri(input: { issuer: string; account: string; secret: Buffer }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const parameters = new URLSearchParams({
    secret: base32Encode(input.secret),
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${parameters.toString()}`;
}

/** The secret as a person types it into an authenticator that cannot scan: groups of four. */
export function readableSecret(secret: Buffer): string {
  return (base32Encode(secret).match(/.{1,4}/g) ?? []).join(' ');
}
