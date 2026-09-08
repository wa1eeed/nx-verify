import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import {
  getAttestationTimeline,
  getEntity,
  getEntityProfile,
  listIdentifiers,
} from '@nx-verify/core';
import { getKeys } from '../../../lib/keys';
import { Entity360 } from '../../../components/entity-360';
import { query } from '../../../lib/context';
import type { ProfileFieldView } from '../../../components/field-card';
import type { TimelineEntryView, TriggeredBy } from '../../../components/timeline';

/**
 * Entity 360 on real data.
 *
 * Identifiers are masked before they leave the query (rule 4), the provider is never
 * selected (rule 5), and each field arrives with its authority and observed_at already
 * attached, because the component will not render one without them.
 */

export default async function EntityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;

  const data = await query(async (tx) => {
    const entity = await getEntity(tx, id);
    if (!entity) {
      return null;
    }

    // Sequential, not Promise.all. These share one connection inside one transaction,
    // and a pg client cannot serve two queries at once.
    const profile = await getEntityProfile(tx, id);
    const identifiers = await listIdentifiers(tx, getKeys(), id);
    const timeline = await getAttestationTimeline(tx, id, { limit: 40 });

    const { rows: triggers } = await tx.query<{ id: string; triggered_by: TriggeredBy }>(
      `SELECT id, triggered_by FROM verification_runs WHERE tenant_id = $1`,
      [tx.tenantId],
    );

    return { entity, profile, identifiers, timeline, triggers };
  });

  if (!data) {
    notFound();
  }

  const triggerByRun = new Map(data.triggers.map((row) => [row.id, row.triggered_by]));

  const fields: ProfileFieldView[] = data.profile.map((field) => ({
    fieldPath: field.fieldPath,
    value: field.value,
    // A field without an authority cannot be displayed, so an empty one is named as such
    // rather than quietly rendered blank.
    authority: field.authority ?? 'غير محدد',
    observedAt: field.observedAt,
    effectiveUntil: field.effectiveUntil,
    freshness: field.freshness,
    confidence: field.confidence,
  }));

  const entries: TimelineEntryView[] = data.timeline.map((entry) => ({
    attestationId: entry.attestationId,
    fieldPath: entry.fieldPath,
    value: entry.value,
    authority: entry.authority ?? 'غير محدد',
    observedAt: entry.observedAt,
    triggeredBy: triggerByRun.get(entry.runId) ?? 'API',
    changed: entry.supersededBy === null,
  }));

  const trackedFields = 6;

  return (
    <Entity360
      header={{
        entityId: id,
        displayName: data.entity.displayName,
        entityType: data.entity.entityType,
        identifiers: data.identifiers.map((identifier) => ({
          idType: identifier.idType,
          masked: identifier.masked,
        })),
        score: null,
        completeness: Math.min(100, Math.round((fields.length / trackedFields) * 100)),
      }}
      fields={fields}
      changes={[]}
      timeline={entries}
    />
  );
}
