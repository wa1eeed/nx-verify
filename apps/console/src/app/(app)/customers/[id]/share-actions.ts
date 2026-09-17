'use server';

import { revalidatePath } from 'next/cache';
import { audit, createShare, revokeShare, type FieldGroup } from '@nx-verify/core';
import type { TenantTransaction } from '@nx-verify/db';
import { actingUser, query } from '../../../../lib/context';
import { sendNow } from '../../../../lib/mail';
import { isAddress, shareMail } from '../../../../lib/share-mail';
import type { IssuedShareState } from '../../../../components/issued-once';

/**
 * Issuing and withdrawing a link to a profile.
 *
 * Both are written to the audit log, because a disclosure of somebody else's verified
 * data is exactly the kind of action that gets asked about months later, and the answer
 * cannot be "we think Ahmed did it".
 *
 * The token is returned once, to the screen that asked, and never read again. Nothing here
 * can produce it a second time, including us. It used to come back in the address, which put
 * a live link into the browser's history and into every access log between here and the
 * browser (SEC-10).
 *
 * A link can leave by mail instead (ADR-144). Then it is not shown at all: the copy in the
 * mailbox is the only one, and a screen that also prints it is a second copy on a machine
 * that was not meant to keep one. It is sent directly rather than queued, because the queue
 * delivers to verified channels inside the workspace and stores every subject and body it
 * sends, and a live link belongs in neither.
 */

export async function createShareAction(
  _previous: IssuedShareState,
  formData: FormData,
): Promise<IssuedShareState> {
  const user = await actingUser();
  const entityId = String(formData.get('entity_id') ?? '');
  const groups = formData.getAll('groups').map((value) => String(value)) as FieldGroup[];
  const ttlDays = Number(formData.get('ttl_days') ?? 30);
  const purpose = String(formData.get('purpose') ?? '').trim();
  const recipient = String(formData.get('recipient') ?? '').trim();

  if (entityId === '' || groups.length === 0) {
    return { link: null, sentTo: null, refused: null };
  }
  if (recipient !== '' && !isAddress(recipient)) {
    return { link: null, sentTo: null, refused: 'address' };
  }

  const created = await query(async (tx) => {
    const share = await createShare(tx, {
      entityId,
      groups,
      ttlDays: Number.isFinite(ttlDays) ? ttlDays : 30,
      purpose: purpose === '' ? null : purpose,
      createdBy: user.userId,
    });

    await audit(tx, {
      actorType: 'USER',
      actorId: user.userId,
      action: 'profile.shared',
      target: entityId,
      // What was opened, for how long, and to whom it was sent. Never the token: an audit
      // row that carries a live link is a live link in a table anyone auditing can read.
      // The address is the whole point of recording this one: months later the question is
      // «who did we send this customer's file to», and a share with no recipient cannot
      // answer it.
      metadata: {
        groups,
        ttl_days: ttlDays,
        share_id: share.shareId,
        ...(recipient === '' ? {} : { sent_to: recipient }),
      },
    });

    const names = await namesFor(tx, entityId);
    return { ...share, ...names };
  });

  const link = `${process.env['NX_CONSOLE_BASE_URL'] ?? ''}/p/${created.token}`;

  if (recipient === '') {
    revalidatePath(`/customers/${entityId}`);
    // Shown once, on the screen that asked for it. A refresh loses it, which is correct:
    // a link that can be recovered from a page is a link that never really expires.
    return { link, sentTo: null, refused: null };
  }

  const composed = shareMail({
    customerName: created.customerName,
    senderName: created.senderName,
    groups,
    link,
    expiresAt: created.expiresAt,
    purpose: purpose === '' ? null : purpose,
  });
  const sent = await sendNow({
    to: recipient,
    // No name: this person is a stranger to the workspace, and we know nothing about them
    // beyond the address somebody typed.
    toName: null,
    subject: composed.subject,
    body: composed.body,
  });

  if (!sent) {
    // A link that was made and never delivered is a live link nobody holds. Withdraw it
    // rather than leave it in the list for somebody to wonder about, and say so plainly:
    // this failure is the platform's, not the subscriber's.
    await query(async (tx) => {
      await revokeShare(tx, created.shareId);
      await audit(tx, {
        actorType: 'USER',
        actorId: user.userId,
        action: 'profile.share_revoked',
        target: entityId,
        metadata: { share_id: created.shareId, reason: 'mail_failed' },
      });
    });
    revalidatePath(`/customers/${entityId}`);
    return { link: null, sentTo: null, refused: 'mail' };
  }

  revalidatePath(`/customers/${entityId}`);
  return { link: null, sentTo: recipient, refused: null };
}

/**
 * Who is sharing, and whose file.
 *
 * Both are read inside the same scope the share was made in, so a name from another
 * workspace cannot reach a message this one sends.
 */
async function namesFor(
  tx: TenantTransaction,
  entityId: string,
): Promise<{ customerName: string; senderName: string }> {
  const { rows } = await tx.query<{ customer: string | null; sender: string | null }>(
    `SELECT e.display_name AS customer, t.name AS sender
       FROM entities e JOIN tenants t ON t.id = e.tenant_id
      WHERE e.tenant_id = $1 AND e.id = $2`,
    [tx.tenantId, entityId],
  );
  return {
    customerName: rows[0]?.customer ?? 'العميل',
    senderName: rows[0]?.sender ?? 'مشترك في NX Trust',
  };
}

export async function revokeShareAction(formData: FormData): Promise<void> {
  const user = await actingUser();
  const entityId = String(formData.get('entity_id') ?? '');
  const shareId = String(formData.get('share_id') ?? '');
  if (entityId === '' || shareId === '') {
    return;
  }

  await query(async (tx) => {
    await revokeShare(tx, shareId);
    await audit(tx, {
      actorType: 'USER',
      actorId: user.userId,
      action: 'profile.share_revoked',
      target: entityId,
      metadata: { share_id: shareId },
    });
  });

  revalidatePath(`/customers/${entityId}`);
}
