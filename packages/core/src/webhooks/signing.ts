import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signatures.
 *
 * The signed string includes the timestamp, not just the body. Signing the body alone
 * lets anyone who captured one delivery replay it forever, and a customer verifying only
 * the body has no way to notice.
 *
 * The header format follows the convention customers already know from Stripe, because
 * the integration engineer reading our docs has almost certainly implemented it before,
 * and a familiar format is one fewer thing to get wrong at their end.
 */

export const SIGNATURE_HEADER = 'nx-signature';
export const DEFAULT_TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, payload: string, timestamp: number): string {
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

export interface VerifyOptions {
  toleranceSeconds?: number;
  now?: number;
}

export function verifySignature(
  secret: string,
  payload: string,
  header: string,
  options: VerifyOptions = {},
): boolean {
  const parts = new Map(
    header.split(',').map((part) => {
      const index = part.indexOf('=');
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()] as const;
    }),
  );

  const timestamp = Number(parts.get('t'));
  const provided = parts.get('v1');
  if (!Number.isFinite(timestamp) || !provided) {
    return false;
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) {
    // Outside the window. A captured delivery cannot be replayed indefinitely.
    return false;
  }

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');

  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(provided, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Retry schedule. Exponential with a cap, and it gives up rather than retrying forever:
 * an endpoint that has been down for a day is not going to be fixed by attempt two
 * hundred, and the deliveries are still readable in the console.
 */
export const RETRY_DELAYS_SECONDS: readonly number[] = [30, 120, 600, 3_600, 21_600, 86_400];

export function nextRetryAt(attempts: number, from = new Date()): Date | null {
  const delay = RETRY_DELAYS_SECONDS[attempts];
  if (delay === undefined) {
    return null;
  }
  return new Date(from.getTime() + delay * 1000);
}
