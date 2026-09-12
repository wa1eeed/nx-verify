import type { ReactElement } from 'react';
import { listRulesets, simulateRuleset } from '@nx-verify/core';
import { RulesStudio, describeCondition, type RuleRowView } from '../../../../components/rules-studio';
import { query } from '../../../../lib/context';

/**
 * Never prerendered and never cached.
 *
 * This page reads one tenant's live data, and a build machine has no database and no
 * business holding a copy of it. Rendering it at request time is also what keeps a page
 * from showing a snapshot of somebody else's tenant after a deployment.
 */
export const dynamic = 'force-dynamic';

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ ruleset?: string; simulate?: string }>;
}): Promise<ReactElement> {
  const params = await searchParams;

  const data = await query(async (tx) => {
    const rulesets = await listRulesets(tx);
    const chosen = rulesets.find((entry) => entry.id === params.ruleset) ?? rulesets[0];
    if (!chosen) {
      return null;
    }

    const { rows } = await tx.query<{
      seq: number;
      condition: Record<string, unknown>;
      outcome: 'PASS' | 'FAIL' | 'REVIEW';
      reason_ar: string;
    }>(
      `SELECT seq, condition, outcome, reason_ar
       FROM decision_rules WHERE ruleset_id = $1 ORDER BY seq`,
      [chosen.id],
    );

    const simulation =
      params.simulate === '1' ? await simulateRuleset(tx, chosen.id, { limit: 200 }) : undefined;

    return { chosen, rows, simulation };
  });

  if (!data) {
    return <p className="muted">لا توجد مجموعات قواعد بعد.</p>;
  }

  const rules: RuleRowView[] = data.rows.map((row) => ({
    seq: row.seq,
    description: describeCondition(row.condition),
    outcome: row.outcome,
    reasonAr: row.reason_ar,
  }));

  return (
    <RulesStudio
      rulesetName={data.chosen.nameAr}
      isDefault={data.chosen.isDefault}
      rules={rules}
      {...(data.simulation
        ? {
            simulation: {
              entitiesEvaluated: data.simulation.entitiesEvaluated,
              outcomes: data.simulation.outcomes,
              changed: data.simulation.changed,
            },
          }
        : {})}
    />
  );
}
