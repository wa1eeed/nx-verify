import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';

/**
 * Proving that a notification address belongs to whoever typed it (ADR-145).
 *
 * `verified_at` has gated delivery since the queue was built: nothing is sent to an address
 * that has not been proved. What was missing was any way to prove one, so the gate was shut
 * for everybody and a subscriber could not subscribe to anything.
 *
 * A code to the address is the only thing that actually establishes the claim, because the
 * claim is «whoever reads this mailbox asked for this». Typing an address into a form claims
 * nothing: a person who mistypes a colleague's address, or types a customer's on purpose,
 * would otherwise have our platform mailing a stranger on their behalf.
 *
 * Shaped like the sign in code (ADR-143) and for the same reasons: the digits are never
 * stored, the digest is salted with the address, five guesses spend it, and every refusal is
 * the same refusal.
 */

const CODE_DIGITS = 6;
export const MAX_PROOF_ATTEMPTS = 5;
export const PROOF_TTL_MINUTES = 30;
/** A second code for the same address is refused inside this. */
export const PROOF_RESEND_AFTER_SECONDS = 60;

/** The code, salted with the address it is being sent to. */
function proofDigest(address: string, code: string): Buffer {
  return createHash('sha256').update(`${address.trim().toLowerCase()}:${code}`).digest();
}

function sixDigits(): string {
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
}

export interface IssuedProof {
  /** Where to send it. Read back from the row, never taken from the caller. */
  address: string;
  displayName: string | null;
  /** The six digits. Returned once, to be mailed and then forgotten. */
  code: string;
  expiresAt: Date;
}

/**
 * Issues a code for an address that is waiting to be proved.
 *
 * Refuses an address that is already proved, one that does not exist, and a second code
 * inside a minute. The first two are the same refusal deliberately: a caller who can tell an
 * unknown channel from another workspace's channel has learned that the other workspace has
 * one, and row level security is not the only place that leaks.
 */
export async function startChannelProof(
  tx: TenantTransaction,
  channelId: string,
): Promise<IssuedProof> {
  const { rows } = await tx.query<{
    address: string;
    display_name: string | null;
    verified_at: Date | null;
    proof_sent_at: Date | null;
  }>(
    `SELECT address, display_name, verified_at, proof_sent_at
       FROM notification_channels
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE`,
    [tx.tenantId, channelId],
  );

  const channel = rows[0];
  if (channel === undefined || channel.verified_at !== null) {
    throw new NxError('NX-4041', {
      detail: 'no address here is waiting to be proved',
      cause: 'لا عنوان بانتظار الإثبات.',
    });
  }

  const last = channel.proof_sent_at;
  if (last !== null && Date.now() - last.getTime() < PROOF_RESEND_AFTER_SECONDS * 1_000) {
    throw new NxError('NX-4029', {
      detail: 'a proof was sent moments ago',
      cause: 'أُرسل رمز قبل قليل. انتظر دقيقة ثم اطلب غيره.',
    });
  }

  const code = sixDigits();
  const expiresAt = new Date(Date.now() + PROOF_TTL_MINUTES * 60_000);

  // Asking again replaces what was waiting and returns the budget of guesses: the person
  // asking again is the person who owns the mailbox, and a stale code that nobody has is not
  // what spent those attempts.
  await tx.query(
    `UPDATE notification_channels
        SET proof_hash = $3, proof_attempts = 0, proof_expires_at = $4, proof_sent_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, channelId, proofDigest(channel.address, code), expiresAt],
  );

  return {
    address: channel.address,
    displayName: channel.display_name,
    code,
    expiresAt,
  };
}

/**
 * Spends a code, and proves the address if it was the right one.
 *
 * Every refusal is the same refusal, for the reason six digits exist at all. A wrong guess is
 * counted before it is answered, so a loop that never finishes still spends what it is
 * loosing.
 */
export async function proveChannel(
  tx: TenantTransaction,
  input: { channelId: string; code: string },
): Promise<void> {
  const refuse = (): never => {
    throw new NxError('NX-4011', {
      detail: 'the code is wrong, spent or expired',
      cause: 'الرمز غير صحيح أو انتهت مدته.',
    });
  };

  const { rows } = await tx.query<{
    address: string;
    proof_hash: Buffer | null;
    proof_attempts: number;
    proof_expires_at: Date | null;
  }>(
    `SELECT address, proof_hash, proof_attempts, proof_expires_at
       FROM notification_channels
      WHERE tenant_id = $1 AND id = $2 AND verified_at IS NULL
      FOR UPDATE`,
    [tx.tenantId, input.channelId],
  );

  const pending = rows[0];
  if (
    pending === undefined ||
    pending.proof_hash === null ||
    pending.proof_expires_at === null ||
    pending.proof_expires_at.getTime() <= Date.now() ||
    pending.proof_attempts >= MAX_PROOF_ATTEMPTS
  ) {
    return refuse();
  }

  const offered = proofDigest(pending.address, input.code.trim());
  const matches =
    offered.length === pending.proof_hash.length && timingSafeEqual(offered, pending.proof_hash);

  if (!matches) {
    await tx.query(
      `UPDATE notification_channels SET proof_attempts = proof_attempts + 1
        WHERE tenant_id = $1 AND id = $2`,
      [tx.tenantId, input.channelId],
    );
    return refuse();
  }

  // Proved. The pending proof is cleared in the same statement, because a proved address
  // holding a live code is a second way in to a thing that is already settled.
  await tx.query(
    `UPDATE notification_channels
        SET verified_at = now(), proof_hash = NULL, proof_attempts = 0,
            proof_expires_at = NULL
      WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, input.channelId],
  );
}

/**
 * Removes an address and every subscription that pointed at it.
 *
 * A subscriber must be able to take an address off the list: somebody leaves the company and
 * their mailbox keeps receiving alerts about customers, which is the quiet kind of disclosure
 * nobody notices for a year. The rules go with it by the foreign key's cascade; deliveries
 * already sent keep their row, because what left is a fact.
 */
export async function removeChannel(tx: TenantTransaction, channelId: string): Promise<void> {
  await tx.query(
    `UPDATE notification_rules SET status = 'disabled'
      WHERE tenant_id = $1 AND channel_id = $2`,
    [tx.tenantId, channelId],
  );
  await tx.query(
    `UPDATE notification_channels SET status = 'disabled', verified_at = NULL,
            proof_hash = NULL, proof_attempts = 0, proof_expires_at = NULL
      WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, channelId],
  );
}
