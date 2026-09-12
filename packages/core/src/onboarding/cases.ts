import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { audit } from '../auth/audit.js';
import { decide } from '../decision/engine.js';
import { evaluate, type Condition } from '../decision/conditions.js';
import { resolveRuleset } from '../portfolios/portfolios.js';
import { openCase as openReviewCase } from '../review/queue.js';
import { getEntityProfile } from '../repositories/profile.js';
import { verify } from '../verification/verify.js';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';
import type { StepRunner } from '../orchestration/executor.js';
import type { IdentifierInput } from '../repositories/entities.js';

/**
 * Onboarding, as a file rather than a sequence of calls.
 *
 * Everything else in this platform answers "is this fact true". A company deciding
 * whether to take on a merchant is asking something else: is this applicant acceptable,
 * what was checked before we said so, who said it, when, and what is still outstanding.
 * Those are questions about a file that moves through states, and this module is that
 * file.
 *
 * It owns no verification logic. It knows which checks a journey requires, asks the
 * verification layer for each, judges the result with the same decision engine every
 * other path uses, and records what it concluded. That separation is the point: a case is
 * not a second way to verify, it is a wrapper that turns verifications into an outcome.
 *
 * See ADR-076.
 */

export type CaseStatus =
  | 'IN_PROGRESS'
  | 'AWAITING_INPUT'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN';

export type WaiveReason =
  | 'ALREADY_VERIFIED_ELSEWHERE'
  | 'NOT_APPLICABLE'
  | 'DOCUMENT_ON_FILE'
  | 'RISK_ACCEPTED';

export interface JourneyStepInput {
  stepKey: string;
  productCode: string;
  seq?: number;
  required?: boolean;
  /** When this step applies. Absent means always. */
  appliesWhen?: Condition | null;
  /**
   * Which parts of the applicant record this check is given, as target key to dotted
   * path. Absent hands it the whole record.
   *
   * Products declare their own input schemas and several refuse anything they did not ask
   * for, so the journey says what each check receives rather than every product being
   * forced to tolerate every other product's fields.
   */
  subjectMap?: Record<string, string> | null;
}

export interface DefineJourneyInput {
  code: string;
  nameAr: string;
  descriptionAr?: string;
  slaHours?: number;
  decisionRuleset?: string | null;
  steps: JourneyStepInput[];
}

/** A journey is rows, so a customer adds one without a deployment (rule 8). */
export async function defineJourney(
  tx: TenantTransaction,
  input: DefineJourneyInput,
): Promise<void> {
  await tx.query(
    `INSERT INTO onboarding_journeys (tenant_id, code, name_ar, description_ar, sla_hours,
                                      decision_ruleset)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, code) DO UPDATE SET
       name_ar = EXCLUDED.name_ar,
       description_ar = EXCLUDED.description_ar,
       sla_hours = EXCLUDED.sla_hours,
       decision_ruleset = EXCLUDED.decision_ruleset,
       status = 'active'`,
    [
      tx.tenantId,
      input.code,
      input.nameAr,
      input.descriptionAr ?? null,
      input.slaHours ?? 48,
      input.decisionRuleset ?? null,
    ],
  );

  for (const [index, step] of input.steps.entries()) {
    await tx.query(
      `INSERT INTO onboarding_journey_steps (tenant_id, journey_code, step_key, seq,
                                             product_code, required, applies_when,
                                             subject_map)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
       ON CONFLICT (tenant_id, journey_code, step_key) DO UPDATE SET
         seq = EXCLUDED.seq,
         product_code = EXCLUDED.product_code,
         required = EXCLUDED.required,
         applies_when = EXCLUDED.applies_when,
         subject_map = EXCLUDED.subject_map`,
      [
        tx.tenantId,
        input.code,
        step.stepKey,
        step.seq ?? index + 1,
        step.productCode,
        step.required ?? true,
        step.appliesWhen === undefined || step.appliesWhen === null
          ? null
          : JSON.stringify(step.appliesWhen),
        step.subjectMap === undefined || step.subjectMap === null
          ? null
          : JSON.stringify(step.subjectMap),
      ],
    );
  }
}

export interface Journey {
  code: string;
  nameAr: string;
  descriptionAr: string | null;
  slaHours: number;
  steps: { stepKey: string; seq: number; productCode: string; required: boolean }[];
}

export async function listJourneys(tx: TenantTransaction): Promise<Journey[]> {
  const { rows } = await tx.query<{
    code: string;
    name_ar: string;
    description_ar: string | null;
    sla_hours: number;
  }>(
    `SELECT code, name_ar, description_ar, sla_hours
     FROM onboarding_journeys WHERE tenant_id = $1 AND status = 'active' ORDER BY code`,
    [tx.tenantId],
  );

  const { rows: steps } = await tx.query<{
    journey_code: string;
    step_key: string;
    seq: number;
    product_code: string;
    required: boolean;
  }>(
    `SELECT journey_code, step_key, seq, product_code, required
     FROM onboarding_journey_steps WHERE tenant_id = $1 ORDER BY journey_code, seq`,
    [tx.tenantId],
  );

  return rows.map((row) => ({
    code: row.code,
    nameAr: row.name_ar,
    descriptionAr: row.description_ar,
    slaHours: row.sla_hours,
    steps: steps
      .filter((step) => step.journey_code === row.code)
      .map((step) => ({
        stepKey: step.step_key,
        seq: step.seq,
        productCode: step.product_code,
        required: step.required,
      })),
  }));
}

async function allocateCaseReference(tx: TenantTransaction, at = new Date()): Promise<string> {
  const year = at.getUTCFullYear();
  const { rows } = await tx.query<{ next_value: number }>(
    `INSERT INTO case_counters (tenant_id, year, next_value)
     VALUES ($1, $2, 2)
     ON CONFLICT (tenant_id, year) DO UPDATE SET next_value = case_counters.next_value + 1
     RETURNING CASE WHEN case_counters.next_value IS NULL THEN 1
                    ELSE case_counters.next_value - 1 END AS next_value`,
    [tx.tenantId, year],
  );
  return `ONB-${year}-${String(rows[0]?.next_value ?? 1).padStart(6, '0')}`;
}

export interface OpenCaseInput {
  journeyCode: string;
  clientRef?: string | null;
  openedBy?: string | null;
}

export interface OnboardingCase {
  caseId: string;
  reference: string;
  journeyCode: string;
  entityId: string | null;
  status: CaseStatus;
  outcome: 'PASS' | 'FAIL' | 'REVIEW' | null;
  clientRef: string | null;
  openedAt: Date;
  dueAt: Date;
  closedAt: Date | null;
  overdue: boolean;
  steps: CaseStep[];
}

export interface CaseStep {
  stepKey: string;
  seq: number;
  productCode: string;
  required: boolean;
  status: 'PENDING' | 'DONE' | 'FAILED' | 'WAIVED' | 'NOT_APPLICABLE';
  runId: string | null;
  appliesWhen: Condition | null;
  subjectMap: Record<string, string> | null;
  waiveReason: WaiveReason | null;
  decidedAt: Date | null;
}

export async function openCase(
  tx: TenantTransaction,
  input: OpenCaseInput,
): Promise<OnboardingCase> {
  const { rows: journeys } = await tx.query<{ sla_hours: number }>(
    `SELECT sla_hours FROM onboarding_journeys
     WHERE tenant_id = $1 AND code = $2 AND status = 'active'`,
    [tx.tenantId, input.journeyCode],
  );
  const journey = journeys[0];
  if (!journey) {
    throw new NxError('NX-4041', { detail: 'no such onboarding journey' });
  }

  const reference = await allocateCaseReference(tx);
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO onboarding_cases (tenant_id, journey_code, reference, client_ref, opened_by,
                                   due_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))
     RETURNING id`,
    [
      tx.tenantId,
      input.journeyCode,
      reference,
      input.clientRef ?? null,
      input.openedBy ?? null,
      journey.sla_hours,
    ],
  );

  const caseId = rows[0]?.id;
  if (!caseId) {
    throw new NxError('NX-5001', { detail: 'case insert returned no id' });
  }

  // The checks are copied onto the case rather than read from the journey later, because
  // a journey edited next month must not change what an open file was required to do.
  await tx.query(
    `INSERT INTO onboarding_case_steps (tenant_id, case_id, step_key, seq, product_code,
                                        required, applies_when, subject_map)
     SELECT $1, $2, step_key, seq, product_code, required, applies_when, subject_map
     FROM onboarding_journey_steps
     WHERE tenant_id = $1 AND journey_code = $3`,
    [tx.tenantId, caseId, input.journeyCode],
  );

  await audit(tx, {
    actorType: 'USER',
    actorId: input.openedBy ?? 'system',
    action: 'onboarding.opened',
    target: caseId,
    metadata: { journey: input.journeyCode, reference },
  });

  const opened = await getCase(tx, caseId);
  if (!opened) {
    throw new NxError('NX-5001', { detail: 'the case disappeared after it was opened' });
  }
  return opened;
}

export async function getCase(
  tx: TenantTransaction,
  caseId: string,
  now = new Date(),
): Promise<OnboardingCase | null> {
  const { rows } = await tx.query<{
    id: string;
    reference: string;
    journey_code: string;
    entity_id: string | null;
    status: CaseStatus;
    outcome: 'PASS' | 'FAIL' | 'REVIEW' | null;
    client_ref: string | null;
    opened_at: Date;
    due_at: Date;
    closed_at: Date | null;
  }>(
    `SELECT id, reference, journey_code, entity_id, status, outcome, client_ref,
            opened_at, due_at, closed_at
     FROM onboarding_cases WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, caseId],
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  const { rows: steps } = await tx.query<{
    step_key: string;
    seq: number;
    product_code: string;
    required: boolean;
    status: CaseStep['status'];
    applies_when: Condition | null;
    subject_map: Record<string, string> | null;
    run_id: string | null;
    waive_reason: WaiveReason | null;
    decided_at: Date | null;
  }>(
    `SELECT step_key, seq, product_code, required, status, applies_when, subject_map,
            run_id, waive_reason, decided_at
     FROM onboarding_case_steps
     WHERE tenant_id = $1 AND case_id = $2
     ORDER BY seq`,
    [tx.tenantId, caseId],
  );

  return {
    caseId: row.id,
    reference: row.reference,
    journeyCode: row.journey_code,
    entityId: row.entity_id,
    status: row.status,
    outcome: row.outcome,
    clientRef: row.client_ref,
    openedAt: row.opened_at,
    dueAt: row.due_at,
    closedAt: row.closed_at,
    // Late only while it is still open. A file that closed after its clock ran out was
    // late, and saying so forever helps nobody work today.
    overdue: row.closed_at === null && row.due_at < now,
    steps: steps.map((step) => ({
      stepKey: step.step_key,
      seq: step.seq,
      productCode: step.product_code,
      required: step.required,
      status: step.status,
      appliesWhen: step.applies_when,
      subjectMap: step.subject_map,
      runId: step.run_id,
      waiveReason: step.waive_reason,
      decidedAt: step.decided_at,
    })),
  };
}

/**
 * Hands a check the part of the applicant record it asked for.
 *
 * A product that declares additionalProperties false refuses a record carrying another
 * product's fields, and that strictness is deliberate: a malformed request must cost
 * nothing. The journey therefore says what each check receives.
 */
function projectSubject(
  subject: Record<string, unknown>,
  map: Record<string, string> | null,
): Record<string, unknown> {
  if (!map) {
    return subject;
  }

  const projected: Record<string, unknown> = {};
  for (const [target, path] of Object.entries(map)) {
    const value = path
      .split('.')
      .reduce<unknown>(
        (current, key) =>
          current && typeof current === 'object'
            ? (current as Record<string, unknown>)[key]
            : undefined,
        subject,
      );
    if (value !== undefined) {
      projected[target] = value;
    }
  }
  return projected;
}

export interface AdvanceCaseInput {
  caseId: string;
  /**
   * The applicant's details, supplied by the caller on every call.
   *
   * Not stored on the case, and that is rule 4 rather than an oversight: a subject holds
   * identifiers, identifiers are never kept in the clear, and a case that carried them
   * would be the one table in this platform that does. What the case keeps is the entity
   * the first check resolved, which is ours and says nothing on its own.
   */
  subject: Record<string, unknown>;
  subjectIdentifiers: IdentifierInput[];
  subjectDisplayName?: string;
  runStep: StepRunner;
  keys: TenantKeyProvider;
  actorId?: string;
}

export interface AdvanceResult {
  case: OnboardingCase;
  ran: { stepKey: string; status: CaseStep['status']; runId: string | null }[];
}

/**
 * Runs whatever the file still needs, then judges it.
 *
 * The steps run in order and each one is a real verification through the same path the
 * API uses: same entitlement check, same idempotency, same pricing, same normalisation.
 * A case is not a second way to verify, it is what turns verifications into an outcome.
 *
 * A step whose condition does not hold is marked not applicable rather than skipped
 * quietly, because "we did not check the freelance certificate because this applicant is
 * a company" is an answer, and an absence is not.
 */
export async function advanceCase(
  tx: TenantTransaction,
  input: AdvanceCaseInput,
): Promise<AdvanceResult> {
  const existing = await getCase(tx, input.caseId);
  if (!existing) {
    throw new NxError('NX-4041', { detail: 'no such case' });
  }
  if (existing.closedAt !== null) {
    throw new NxError('NX-4031', { detail: 'this case is closed' });
  }

  const ran: AdvanceResult['ran'] = [];

  for (const step of existing.steps) {
    if (step.status !== 'PENDING') {
      continue;
    }

    // The condition is judged against what is known now, so a step gated on the outcome
    // of an earlier one sees that outcome.
    if (step.appliesWhen) {
      const profile = existing.entityId ? await getEntityProfile(tx, existing.entityId) : [];
      // The same context the decision engine judges with, so a condition written for one
      // means the same thing in the other.
      const context = {
        fields: new Map(profile.map((field) => [field.fieldPath, field])),
        linkCounts: new Map<string, number>(),
      };
      if (!evaluate(step.appliesWhen, context)) {
        await tx.query(
          `UPDATE onboarding_case_steps SET status = 'NOT_APPLICABLE', decided_at = now()
           WHERE tenant_id = $1 AND case_id = $2 AND step_key = $3`,
          [tx.tenantId, input.caseId, step.stepKey],
        );
        ran.push({ stepKey: step.stepKey, status: 'NOT_APPLICABLE', runId: null });
        continue;
      }
    }

    try {
      const result = await verify(tx, {
        productCode: step.productCode,
        subject: projectSubject(input.subject, step.subjectMap),
        subjectIdentifiers: input.subjectIdentifiers,
        ...(input.subjectDisplayName === undefined
          ? {}
          : { subjectDisplayName: input.subjectDisplayName }),
        // The case and the step identify the work, so re-advancing a case cannot run the
        // same check twice or charge for it twice (rule 7).
        idempotencyKey: `case:${input.caseId}:${step.stepKey}`,
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: input.runStep,
        keys: input.keys,
      });

      const status: CaseStep['status'] = result.status === 'ERROR' ? 'FAILED' : 'DONE';
      await tx.query(
        `UPDATE onboarding_case_steps
         SET status = $4, run_id = $5, decided_at = now()
         WHERE tenant_id = $1 AND case_id = $2 AND step_key = $3`,
        [tx.tenantId, input.caseId, step.stepKey, status, result.runId],
      );

      if (existing.entityId === null && result.entityId !== null) {
        await tx.query(
          `UPDATE onboarding_cases SET entity_id = $3 WHERE tenant_id = $1 AND id = $2`,
          [tx.tenantId, input.caseId, result.entityId],
        );
        existing.entityId = result.entityId;
      }

      ran.push({ stepKey: step.stepKey, status, runId: result.runId });
    } catch (error) {
      // A refusal to run is the file's problem, not the loop's: the step is marked and
      // the rest of the checks still happen, because a customer who is told one thing
      // failed can act, and one whose file stopped halfway cannot.
      await tx.query(
        `UPDATE onboarding_case_steps SET status = 'FAILED', decided_at = now()
         WHERE tenant_id = $1 AND case_id = $2 AND step_key = $3`,
        [tx.tenantId, input.caseId, step.stepKey],
      );
      ran.push({ stepKey: step.stepKey, status: 'FAILED', runId: null });
      if (!(error instanceof NxError)) {
        throw error;
      }
    }
  }

  const concluded = await concludeCase(tx, input.caseId, input.actorId);
  return { case: concluded, ran };
}

/**
 * Decides the file once nothing is outstanding.
 *
 * The decision is the customer's own ruleset over the entity's profile, which is the same
 * engine every other path uses: a case does not get its own notion of acceptable. What it
 * adds is what happens to the file afterwards, and one rule that belongs to onboarding
 * rather than to any single check: a required check that failed sends the file to a
 * person. Auto rejecting on a provider's bad afternoon would reject real applicants.
 */
export async function concludeCase(
  tx: TenantTransaction,
  caseId: string,
  actorId?: string,
): Promise<OnboardingCase> {
  const current = await getCase(tx, caseId);
  if (!current) {
    throw new NxError('NX-4041', { detail: 'no such case' });
  }
  if (current.closedAt !== null) {
    return current;
  }

  const required = current.steps.filter((step) => step.required);
  const outstanding = required.filter((step) => step.status === 'PENDING');
  const failed = required.filter((step) => step.status === 'FAILED');

  if (outstanding.length > 0) {
    return current;
  }

  if (failed.length > 0) {
    await setStatus(tx, caseId, 'IN_REVIEW', null, actorId);
    await openReviewCaseFor(tx, current, failed.map((step) => `STEP_FAILED_${step.stepKey}`));
    return (await getCase(tx, caseId)) ?? current;
  }

  if (!current.entityId) {
    // Every required check was waived or did not apply, so nothing was established and
    // there is nothing to judge. A person decides.
    await setStatus(tx, caseId, 'IN_REVIEW', null, actorId);
    return (await getCase(tx, caseId)) ?? current;
  }

  const { rows } = await tx.query<{ decision_ruleset: string | null }>(
    `SELECT decision_ruleset FROM onboarding_journeys
     WHERE tenant_id = $1 AND code = $2`,
    [tx.tenantId, current.journeyCode],
  );

  const ruleset = await resolveRuleset(tx, current.entityId, rows[0]?.decision_ruleset ?? null);
  const decision = await decide(tx, current.entityId, ruleset);

  if (!decision) {
    await setStatus(tx, caseId, 'IN_REVIEW', null, actorId);
    return (await getCase(tx, caseId)) ?? current;
  }

  if (decision.outcome === 'PASS') {
    await setStatus(tx, caseId, 'APPROVED', 'PASS', actorId);
  } else if (decision.outcome === 'FAIL') {
    await setStatus(tx, caseId, 'REJECTED', 'FAIL', actorId);
  } else {
    await setStatus(tx, caseId, 'IN_REVIEW', 'REVIEW', actorId);
    await openReviewCaseFor(tx, current, decision.reasons.map((reason) => reason.code));
  }

  return (await getCase(tx, caseId)) ?? current;
}

async function openReviewCaseFor(
  tx: TenantTransaction,
  onboarding: OnboardingCase,
  reasonCodes: string[],
): Promise<void> {
  if (!onboarding.entityId) {
    return;
  }
  const runId = onboarding.steps.find((step) => step.runId !== null)?.runId;
  if (!runId) {
    return;
  }
  // A file that needs a person gets a queue item, because a review nobody is given is a
  // review nobody does.
  await openReviewCase(tx, { entityId: onboarding.entityId, runId, reasonCodes });
}

async function setStatus(
  tx: TenantTransaction,
  caseId: string,
  status: CaseStatus,
  outcome: 'PASS' | 'FAIL' | 'REVIEW' | null,
  actorId?: string,
): Promise<void> {
  const closing = status === 'APPROVED' || status === 'REJECTED' || status === 'WITHDRAWN';

  await tx.query(
    `UPDATE onboarding_cases
     SET status = $3, outcome = coalesce($4, outcome),
         closed_at = CASE WHEN $5 THEN now() ELSE NULL END,
         closed_by = CASE WHEN $5 THEN $6::uuid ELSE NULL END
     WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, caseId, status, outcome, closing, actorId ?? null],
  );

  await audit(tx, {
    actorType: 'USER',
    actorId: actorId ?? 'system',
    action: `onboarding.${status.toLowerCase()}`,
    target: caseId,
    metadata: { outcome },
  });
}

export interface WaiveStepInput {
  caseId: string;
  stepKey: string;
  reason: WaiveReason;
  actorId: string;
}

/**
 * A person decides a check is not needed.
 *
 * The reason comes from a closed set (rule 6). A waiver that can say anything is a waiver
 * nobody can report on, and "how often do we waive the address check, and why" is exactly
 * the question an auditor asks.
 */
export async function waiveStep(tx: TenantTransaction, input: WaiveStepInput): Promise<void> {
  const { rowCount } = await tx.query(
    `UPDATE onboarding_case_steps
     SET status = 'WAIVED', waive_reason = $4, waived_by = $5::uuid, decided_at = now()
     WHERE tenant_id = $1 AND case_id = $2 AND step_key = $3 AND status = 'PENDING'`,
    [tx.tenantId, input.caseId, input.stepKey, input.reason, input.actorId],
  );

  if ((rowCount ?? 0) === 0) {
    throw new NxError('NX-4091', { detail: 'that step is not waitable any more' });
  }

  await audit(tx, {
    actorType: 'USER',
    actorId: input.actorId,
    action: 'onboarding.step_waived',
    target: input.caseId,
    metadata: { step: input.stepKey, reason: input.reason },
  });
}

export interface CaseSummary {
  caseId: string;
  reference: string;
  journeyCode: string;
  entityId: string | null;
  status: CaseStatus;
  outcome: 'PASS' | 'FAIL' | 'REVIEW' | null;
  openedAt: Date;
  dueAt: Date;
  overdue: boolean;
  done: number;
  total: number;
}

export async function listCases(
  tx: TenantTransaction,
  options: { open?: boolean; limit?: number; now?: Date } = {},
): Promise<CaseSummary[]> {
  const now = options.now ?? new Date();
  const { rows } = await tx.query<{
    id: string;
    reference: string;
    journey_code: string;
    entity_id: string | null;
    status: CaseStatus;
    outcome: 'PASS' | 'FAIL' | 'REVIEW' | null;
    opened_at: Date;
    due_at: Date;
    closed_at: Date | null;
    done: string;
    total: string;
  }>(
    `SELECT c.id, c.reference, c.journey_code, c.entity_id, c.status, c.outcome,
            c.opened_at, c.due_at, c.closed_at,
            count(*) FILTER (WHERE s.status <> 'PENDING')::text AS done,
            count(*)::text AS total
     FROM onboarding_cases c
     LEFT JOIN onboarding_case_steps s ON s.tenant_id = c.tenant_id AND s.case_id = c.id
     WHERE c.tenant_id = $1 AND ($2::boolean IS NOT TRUE OR c.closed_at IS NULL)
     GROUP BY c.id
     ORDER BY c.closed_at NULLS FIRST, c.due_at
     LIMIT $3`,
    [tx.tenantId, options.open ?? false, options.limit ?? 100],
  );

  return rows.map((row) => ({
    caseId: row.id,
    reference: row.reference,
    journeyCode: row.journey_code,
    entityId: row.entity_id,
    status: row.status,
    outcome: row.outcome,
    openedAt: row.opened_at,
    dueAt: row.due_at,
    overdue: row.closed_at === null && row.due_at < now,
    done: Number(row.done),
    total: Number(row.total),
  }));
}
