import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { withTenant } from '@nx-verify/db';
import {
  computeScore,
  getEntity,
  getEntityProfile,
  listIdentifiers,
  recordShareView,
  resolveShare,
  type FieldGroup,
} from '@nx-verify/core';
import { getPool } from '../../../../lib/context';
import { getKeys } from '../../../../lib/keys';
import { SharedProfile, type SharedProfileView } from '../../../../components/shared-profile';
import type { ProfileFieldView } from '../../../../components/field-card';

/**
 * Never prerendered and never cached.
 *
 * A shared profile is live data behind a revocable link. A cached copy would keep serving
 * a link after it was revoked, which is the one thing revocation has to mean.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The only page in this app that renders without a session.
 *
 * The tenant comes from the link rather than from a cookie, and that is safe for exactly
 * one reason: the link was resolved by a function that refuses an expired or revoked one
 * in the database. Every query after that runs inside that tenant's scope like any other,
 * so a bug here can reach one profile and never a second workspace.
 *
 * A bad link is a 404 and not a message. Telling a stranger that a link existed and has
 * expired tells them the link format is right and the workspace is real.
 */
export default async function SharedProfilePage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<ReactElement> {
  const { token } = await params;
  const pool = getPool();

  const share = await resolveShare(
    { query: (text, values) => pool.query(text, values as unknown[] | undefined) },
    token,
  );
  if (!share) {
    notFound();
  }

  const data = await withTenant(pool, share.tenantId, async (tx) => {
    const entity = await getEntity(tx, share.entityId);
    if (!entity) {
      return null;
    }
    const profile = await getEntityProfile(tx, share.entityId);
    const identifiers = await listIdentifiers(tx, getKeys(), share.entityId);
    const score = await computeScore(tx, share.entityId);

    const { rows: workspace } = await tx.query<{ legal_name: string }>(
      `SELECT legal_name FROM tenants WHERE id = $1`,
      [tx.tenantId],
    );
    const { rows: expiry } = await tx.query<{ expires_at: Date }>(
      `SELECT expires_at FROM profile_shares WHERE tenant_id = $1 AND id = $2`,
      [tx.tenantId, share.shareId],
    );

    // Counted after the read succeeded, so a failed render is not recorded as a view.
    await recordShareView(tx, share.shareId);

    return { entity, profile, identifiers, score, workspace: workspace[0], expiry: expiry[0] };
  });

  if (!data || !data.expiry) {
    notFound();
  }

  /**
   * A field with no authority is dropped rather than labelled.
   *
   * The console shows it as "unspecified", which is right for a colleague who can go and
   * find out. To a reader outside the company it would be a claim with nothing behind it
   * on a page whose entire value is that every claim names its source, and one such row
   * discredits the rest of the page.
   */
  const fields: ProfileFieldView[] = data.profile
    .filter((field) => field.authority !== null && field.authority !== '')
    .map((field) => ({
      fieldPath: field.fieldPath,
      value: field.value,
      // The official body, never the provider that carried the question (rule 5).
      authority: field.authority ?? '',
      observedAt: field.observedAt,
      effectiveUntil: field.effectiveUntil,
      freshness: field.freshness,
      confidence: field.confidence,
    }));

  const view: SharedProfileView = {
    displayName: data.entity.displayName,
    entityType: data.entity.entityType,
    identifiers: data.identifiers.map((identifier) => ({
      idType: identifier.idType,
      masked: identifier.masked,
    })),
    score: data.score.score,
    fields,
    openGroups: share.groups as FieldGroup[],
    sharedBy: data.workspace?.legal_name ?? 'مساحة عمل في NX Trust',
    expiresAt: data.expiry.expires_at,
  };

  return <SharedProfile view={view} />;
}
