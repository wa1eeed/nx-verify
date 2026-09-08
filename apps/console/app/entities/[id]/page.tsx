import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import {
  computeScore,
  getAttestationTimeline,
  getEntity,
  getEntityProfile,
  getRelations,
  listIdentifiers,
} from '@nx-verify/core';
import { getKeys } from '../../../lib/keys';
import { Entity360 } from '../../../components/entity-360';
import { query } from '../../../lib/context';

/**
 * Never prerendered and never cached.
 *
 * This page reads one tenant's live data, and a build machine has no database and no
 * business holding a copy of it. Rendering it at request time is also what keeps a page
 * from showing a snapshot of somebody else's tenant after a deployment.
 */
export const dynamic = 'force-dynamic';

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

    const score = await computeScore(tx, id);
    const edges = await getRelations(tx, id);

    // Names and link counts for the other side of each relation. The count is what turns
    // a list of relationships into a signal: one person signing for several companies.
    const otherIds = edges.map((edge) =>
      edge.fromEntity === id ? edge.toEntity : edge.fromEntity,
    );
    const { rows: others } = await tx.query<{
      id: string;
      display_name: string | null;
      linked: string;
    }>(
      `SELECT e.id, e.display_name,
              (SELECT count(DISTINCT r.from_entity)
               FROM entity_relations r
               WHERE r.tenant_id = e.tenant_id AND r.to_entity = e.id AND r.ended_at IS NULL
              )::text AS linked
       FROM entities e
       WHERE e.tenant_id = $1 AND e.id = ANY($2::uuid[])`,
      [tx.tenantId, otherIds],
    );

    return { entity, profile, identifiers, timeline, triggers, score, edges, others };
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
  const otherById = new Map(
    data.others.map((row) => [row.id, { name: row.display_name, linked: Number(row.linked) }]),
  );

  const relations = data.edges.map((edge) => {
    const otherId = edge.fromEntity === id ? edge.toEntity : edge.fromEntity;
    const other = otherById.get(otherId);
    return {
      relType: edge.relType,
      otherEntityId: otherId,
      otherName: other?.name ?? null,
      direction: edge.fromEntity === id ? ('from' as const) : ('to' as const),
      linkedCount: other?.linked ?? 0,
    };
  });

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
        score: data.score.score,
        scoreBreakdown: data.score.breakdown.components.map((component) => ({
          fieldPath: component.fieldPath,
          weight: component.weight,
          earned: component.earned,
          freshness: component.freshness,
        })),
        completeness: Math.min(100, Math.round((fields.length / trackedFields) * 100)),
      }}
      fields={fields}
      changes={[]}
      timeline={entries}
      relations={relations}
    />
  );
}
