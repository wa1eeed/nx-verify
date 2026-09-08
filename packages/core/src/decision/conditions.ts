import type { ProfileField } from '../repositories/profile.js';

/**
 * The condition language, which is deliberately not a language.
 *
 * Seven operators, each a lookup and a comparison. Anything richer would be a program
 * stored in a table, and a program in a table is code that is never reviewed, never type
 * checked and never deployed. When a rule genuinely needs more than this, the honest
 * answer is a new operator here, added with a test, rather than an expression evaluator
 * that can express anything and be understood by nobody.
 */

export type ConditionOperator =
  'eq' | 'ne' | 'in' | 'missing' | 'present' | 'stale' | 'linked_gte' | 'always';

export interface Condition {
  op: ConditionOperator;
  field?: string;
  value?: unknown;
  relation?: string;
}

export interface EvaluationContext {
  fields: ReadonlyMap<string, ProfileField>;
  /** Highest number of entities any one counterparty is linked to, by relation type. */
  linkCounts: ReadonlyMap<string, number>;
}

export function evaluate(condition: Condition, context: EvaluationContext): boolean {
  switch (condition.op) {
    case 'always':
      return true;

    case 'missing':
      return !hasUsableValue(condition.field, context);

    case 'present':
      return hasUsableValue(condition.field, context);

    case 'stale': {
      const field = lookup(condition.field, context);
      // A field we have not confirmed recently is not evidence of anything today. This
      // is why freshness is a decision input and not only a colour on a screen.
      return field === undefined || field.freshness === 'expired';
    }

    case 'eq': {
      const field = lookup(condition.field, context);
      return field !== undefined && sameValue(field.value, condition.value);
    }

    case 'ne': {
      const field = lookup(condition.field, context);
      // A field we never obtained is not evidence that it differs. Absence is handled by
      // `missing`, and conflating the two turns every incomplete record into a failure.
      return field !== undefined && !sameValue(field.value, condition.value);
    }

    case 'in': {
      const field = lookup(condition.field, context);
      const values = Array.isArray(condition.value) ? condition.value : [];
      return field !== undefined && values.some((entry) => sameValue(field.value, entry));
    }

    case 'linked_gte': {
      const relation = condition.relation ?? '';
      const threshold = typeof condition.value === 'number' ? condition.value : 0;
      return (context.linkCounts.get(relation) ?? 0) >= threshold;
    }
  }
}

function lookup(field: string | undefined, context: EvaluationContext): ProfileField | undefined {
  return field === undefined ? undefined : context.fields.get(field);
}

function hasUsableValue(field: string | undefined, context: EvaluationContext): boolean {
  const entry = lookup(field, context);
  if (entry === undefined) {
    return false;
  }
  // An expired value is present in the table and absent as evidence. A decision that
  // treats four month old data as present is the decision this platform exists to stop.
  return entry.freshness !== 'expired' && entry.value !== null && entry.value !== undefined;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (typeof left === 'string' && typeof right === 'string') {
    return left.toUpperCase() === right.toUpperCase();
  }
  return left === right;
}

export function isCondition(value: unknown): value is Condition {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const op = (value as { op?: unknown }).op;
  return (
    typeof op === 'string' &&
    ['eq', 'ne', 'in', 'missing', 'present', 'stale', 'linked_gte', 'always'].includes(op)
  );
}
