import type { ReactElement } from 'react';
import { listFreshnessPolicy, previewTtlChange } from '@nx-verify/core';
import { FreshnessSettings } from '../../../components/freshness-settings';
import { query } from '../../../lib/context';

/**
 * Retention settings on real data, with the impact preview computed from the tenant's
 * own attestations. The preview writes nothing: it is a question, not a change.
 */
export default async function FreshnessSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ field?: string; ttl?: string }>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const proposedTtl = params.ttl === undefined ? null : Number.parseInt(params.ttl, 10);

  const { rows, preview } = await query(async (tx) => {
    const policy = await listFreshnessPolicy(tx);
    if (!params.field || proposedTtl === null || Number.isNaN(proposedTtl) || proposedTtl <= 0) {
      return { rows: policy, preview: undefined };
    }
    const impact = await previewTtlChange(tx, params.field, proposedTtl);
    return {
      rows: policy,
      preview: {
        fieldPath: impact.fieldPath,
        proposedTtlDays: impact.proposedTtlDays,
        newlyExpired: impact.newlyExpired,
      },
    };
  });

  return <FreshnessSettings rows={rows} preview={preview} />;
}
