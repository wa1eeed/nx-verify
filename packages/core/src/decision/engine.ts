import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { getEntityProfile } from '../repositories/profile.js';
import { evaluate, isCondition, type Condition, type EvaluationContext } from './conditions.js';

/**
 * The decision.
 *
 * Rules are evaluated in order and the first match decides, which is what makes an
 * outcome explainable: there is exactly one reason, and it is the rule that fired. A
 * scoring model that blends everything into a number is harder to defend to the person
 * whose application was refused.
 *
 * The reasons travel with the decision, in both languages, and they name the rule rather
 * than the data, so nothing here can carry an identifier out to a caller (rule 4).
 */

export type Outcome = 'PASS' | 'FAIL' | 'REVIEW';

export interface DecisionReason {
  code: string;
  messageAr: string;
  messageEn: string;
}

export interface Decision {
  outcome: Outcome;
  reasons: DecisionReason[];
  /** The rule that decided, for the audit trail. */
  matchedSeq: number | null;
  rulesetId: string | null;
}

interface RuleRow {
  seq: number;
  condition: unknown;
  outcome: Outcome;
  reason_code: string;
  reason_ar: string;
  reason_en: string;
}

export async function decide(
  tx: TenantTransaction,
  entityId: string,
  rulesetId: string | null,
): Promise<Decision> {
  if (!rulesetId) {
    // A product with no ruleset makes no decision, and says so rather than guessing one.
    return { outcome: 'REVIEW', reasons: [], matchedSeq: null, rulesetId: null };
  }

  const { rows: rules } = await tx.query<RuleRow>(
    `SELECT seq, condition, outcome, reason_code, reason_ar, reason_en
     FROM decision_rules
     WHERE ruleset_id = $1
     ORDER BY seq`,
    [rulesetId],
  );

  if (rules.length === 0) {
    throw new NxError('NX-5001', { detail: 'the ruleset has no rules' });
  }

  const context = await buildContext(tx, entityId);

  for (const rule of rules) {
    if (!isCondition(rule.condition)) {
      throw new NxError('NX-5001', {
        detail: `rule ${rule.seq} carries an unrecognised condition`,
      });
    }

    if (evaluate(rule.condition as Condition, context)) {
      return {
        outcome: rule.outcome,
        reasons: [
          {
            code: rule.reason_code,
            messageAr: rule.reason_ar,
            messageEn: rule.reason_en,
          },
        ],
        matchedSeq: rule.seq,
        rulesetId,
      };
    }
  }

  // Every ruleset ends with an always rule, so reaching here means one is missing.
  throw new NxError('NX-5001', { detail: 'no rule matched and the ruleset has no default' });
}

async function buildContext(tx: TenantTransaction, entityId: string): Promise<EvaluationContext> {
  const profile = await getEntityProfile(tx, entityId);
  const fields = new Map(profile.map((field) => [field.fieldPath, field]));

  // How many entities the busiest counterparty of each kind is attached to. This is the
  // network signal from docs/01-blueprint.md section 5.4, evaluated within one tenant and
  // never across (rule 2).
  const { rows } = await tx.query<{ rel_type: string; max_links: string }>(
    `SELECT r.rel_type, max(link_count)::text AS max_links
     FROM entity_relations r
     JOIN LATERAL (
       SELECT count(DISTINCT inner_r.from_entity) AS link_count
       FROM entity_relations inner_r
       WHERE inner_r.tenant_id = r.tenant_id
         AND inner_r.to_entity = r.to_entity
         AND inner_r.rel_type = r.rel_type
         AND inner_r.ended_at IS NULL
     ) counts ON true
     WHERE r.tenant_id = $1 AND r.from_entity = $2 AND r.ended_at IS NULL
     GROUP BY r.rel_type`,
    [tx.tenantId, entityId],
  );

  const linkCounts = new Map(rows.map((row) => [row.rel_type, Number(row.max_links)]));
  return { fields, linkCounts };
}

/** Applies a decision to a completed run. */
export async function storeDecision(
  tx: TenantTransaction,
  runId: string,
  decision: Decision,
): Promise<void> {
  await tx.query(
    `UPDATE verification_runs
     SET decision = $3, decision_reasons = $4::jsonb
     WHERE tenant_id = $1 AND id = $2`,
    [
      tx.tenantId,
      runId,
      decision.outcome,
      JSON.stringify(
        decision.reasons.map((reason) => ({
          code: reason.code,
          message_ar: reason.messageAr,
          message_en: reason.messageEn,
        })),
      ),
    ],
  );
}

export interface RulesetSummary {
  id: string;
  code: string;
  nameAr: string;
  isDefault: boolean;
}

export async function listRulesets(tx: TenantTransaction): Promise<RulesetSummary[]> {
  const { rows } = await tx.query<{
    id: string;
    code: string;
    name_ar: string;
    tenant_id: string | null;
  }>(
    `SELECT id, code, name_ar, tenant_id
     FROM decision_rulesets
     WHERE tenant_id IS NULL OR tenant_id = $1
     ORDER BY code`,
    [tx.tenantId],
  );

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    isDefault: row.tenant_id === null,
  }));
}

/**
 * Replays a ruleset over entities that already exist.
 *
 * docs/01-blueprint.md section 6.2 asks for simulation on historical data before a rule
 * set is switched on. Changing a decision rule blind is how a compliance team discovers
 * on Monday that four hundred customers are now in review.
 */
export interface SimulationResult {
  entitiesEvaluated: number;
  outcomes: Record<Outcome, number>;
  changed: number;
}

export async function simulateRuleset(
  tx: TenantTransaction,
  rulesetId: string,
  options: { limit?: number } = {},
): Promise<SimulationResult> {
  const { rows } = await tx.query<{ entity_id: string; decision: Outcome | null }>(
    `SELECT DISTINCT ON (e.id) e.id AS entity_id, r.decision
     FROM entities e
     LEFT JOIN verification_runs r
       ON r.tenant_id = e.tenant_id AND r.entity_id = e.id
     WHERE e.tenant_id = $1 AND e.archived_at IS NULL
     ORDER BY e.id, r.created_at DESC
     LIMIT $2`,
    [tx.tenantId, options.limit ?? 500],
  );

  const outcomes: Record<Outcome, number> = { PASS: 0, FAIL: 0, REVIEW: 0 };
  let changed = 0;

  for (const row of rows) {
    const decision = await decide(tx, row.entity_id, rulesetId);
    outcomes[decision.outcome] += 1;
    if (row.decision !== null && row.decision !== decision.outcome) {
      changed += 1;
    }
  }

  return { entitiesEvaluated: rows.length, outcomes, changed };
}

/**
 * Copies a ruleset into one this workspace owns (ADR-149).
 *
 * A subscriber never edits the platform's defaults: the unique index and row level security
 * both refuse it, and they should, because every other workspace inherits them. So the only
 * way to have rules of your own is to take a copy and change that, which is also the honest
 * shape for the question people actually ask, «what if we sent these to review instead».
 *
 * The copy carries the conditions exactly. Conditions are a closed set (ADR-031), not an
 * expression language, and building new ones is a rule builder rather than a form field;
 * what a fork gives you today is the freedom to move an outcome.
 */
export async function forkRuleset(
  tx: TenantTransaction,
  input: { fromRulesetId: string; code: string; nameAr: string },
): Promise<string> {
  const { rows } = await tx
    .query<{ id: string }>(
      `INSERT INTO decision_rulesets (tenant_id, code, name_ar, name_en)
       VALUES ($1, $2, $3, $2)
       RETURNING id`,
      [tx.tenantId, input.code, input.nameAr],
    )
    .catch((error: unknown) => {
      if ((error as { code?: string }).code === '23505') {
        throw new NxError('NX-4091', {
          detail: 'a ruleset with that code already exists here',
          cause: 'يوجد مجموعة قواعد بالرمز نفسه.',
        });
      }
      throw error;
    });

  const id = rows[0]?.id;
  if (!id) {
    throw new NxError('NX-5001', { detail: 'ruleset insert returned no id' });
  }

  // The source is read through the same visibility rule as the list: a platform default or
  // one of this workspace's own, and nothing else. A ruleset id from another workspace
  // copies nothing rather than copying somebody else's policy.
  const { rowCount } = await tx.query(
    `INSERT INTO decision_rules (ruleset_id, seq, condition, outcome, reason_code, reason_ar,
                                 reason_en)
     SELECT $2, r.seq, r.condition, r.outcome, r.reason_code, r.reason_ar, r.reason_en
     FROM decision_rules r
     JOIN decision_rulesets s ON s.id = r.ruleset_id
     WHERE r.ruleset_id = $3 AND (s.tenant_id IS NULL OR s.tenant_id = $1)`,
    [tx.tenantId, id, input.fromRulesetId],
  );

  if ((rowCount ?? 0) === 0) {
    throw new NxError('NX-4041', {
      detail: 'no ruleset to copy from',
      cause: 'لا مجموعة قواعد لنسخها.',
    });
  }

  return id;
}

/**
 * Moves one rule's outcome inside a ruleset this workspace owns.
 *
 * The platform's defaults are out of reach here by the `tenant_id` in the WHERE clause, not
 * by a check in the caller: a statement that cannot touch them is a stronger promise than a
 * rule somebody has to remember.
 *
 * The condition is untouched. Changing what a rule looks at is a different act from changing
 * what it decides, and only the second is safe to do from a dropdown.
 */
export async function setRuleOutcome(
  tx: TenantTransaction,
  input: { rulesetId: string; seq: number; outcome: Outcome },
): Promise<void> {
  const { rowCount } = await tx.query(
    `UPDATE decision_rules r
        SET outcome = $4
       FROM decision_rulesets s
      WHERE s.id = r.ruleset_id AND r.ruleset_id = $2 AND r.seq = $3
        AND s.tenant_id = $1`,
    [tx.tenantId, input.rulesetId, input.seq, input.outcome],
  );

  if (rowCount === 0) {
    throw new NxError('NX-4031', {
      detail: 'that rule is not in a ruleset this workspace owns',
      cause: 'لا تُعدَّل قواعد المنصة الافتراضية. انسخها أولاً إلى مجموعة خاصة بك.',
    });
  }
}
