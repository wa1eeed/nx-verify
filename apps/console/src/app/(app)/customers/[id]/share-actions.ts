'use server';

import { revalidatePath } from 'next/cache';
import { audit, createShare, revokeShare, type FieldGroup } from '@nx-verify/core';
import { actingUser, query } from '../../../../lib/context';
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

  if (entityId === '' || groups.length === 0) {
    return { link: null };
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
      // What was opened and for how long. Never the token: an audit row that carries a
      // live link is a live link in a table anyone auditing can read.
      metadata: { groups, ttl_days: ttlDays, share_id: share.shareId },
    });

    return share;
  });

  revalidatePath(`/customers/${entityId}`);
  // Shown once, on the screen that asked for it. A refresh loses it, which is correct:
  // a link that can be recovered from a page is a link that never really expires.
  return { link: `${process.env['NX_CONSOLE_BASE_URL'] ?? ''}/p/${created.token}` };
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
