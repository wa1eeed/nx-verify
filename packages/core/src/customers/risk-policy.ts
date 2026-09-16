import type { Queryable, TenantTransaction } from '@nx-verify/db';

/**
 * The risk model, as rows rather than as literals (ADR-138, migration 0052).
 *
 * Everything the score is made of used to live in `indicators.ts` as constants: what each
 * signal weighs, the two bands that turn a number into «عالية» or «متوسطة», and the five
 * thresholds buried inside the conditions. That was fine while nobody disagreed. It stops
 * being fine the moment two subscribers do, and they do: a lender's tolerance for «this
 * manager also runs four other companies» is not a marketplace's.
 *
 * So a policy is resolved per subscriber and handed to the pure assessment as data. The
 * defaults here are the exact numbers the code carried, so a deployment that has never opened
 * the panel scores every customer exactly as it did before.
 *
 * Inheritance is by reference. A subscriber with no row inherits the platform's answer, and
 * inherits it again the next time it changes. Copying the defaults onto every subscriber would
 * make the screen simpler and the truth unrecoverable.
 */

export type RiskCategory = 'STATUS' | 'MISMATCH' | 'INTERSECTION' | 'INCOMPLETE' | 'CHANGE' | 'AGE';

export interface RiskSignalPolicy {
  weight: number;
  enabled: boolean;
  /** The one number the condition compares against. Null for a signal that has none. */
  threshold: number | null;
}

export interface RiskPolicy {
  signals: Readonly<Record<string, RiskSignalPolicy>>;
  /** A score at or above this reads as «عالية». */
  highFrom: number;
  /** At or above this, «متوسطة». Below it, «منخفضة». */
  mediumFrom: number;
}

/**
 * The model exactly as it was written, before any of it could be edited.
 *
 * Used when no policy is loaded: the pure assessment stays callable from a test or a screen
 * without a database, and a fresh deployment scores the same as an old one.
 */
export const DEFAULT_RISK_POLICY: RiskPolicy = {
  highFrom: 60,
  mediumFrom: 30,
  signals: {
    registry_inactive: { weight: 60, enabled: true, threshold: null },
    liquidation: { weight: 70, enabled: true, threshold: null },
    iban_mismatch: { weight: 60, enabled: true, threshold: null },
    iban_partial: { weight: 30, enabled: true, threshold: null },
    account_inactive: { weight: 30, enabled: true, threshold: null },
    certificate_inactive: { weight: 60, enabled: true, threshold: null },
    certificate_not_owned: { weight: 65, enabled: true, threshold: null },
    new_business: { weight: 10, enabled: true, threshold: 180 },
    manager_many_companies: { weight: 30, enabled: true, threshold: 3 },
    shared_account: { weight: 60, enabled: true, threshold: 1 },
    shared_address: { weight: 14, enabled: true, threshold: 1 },
    open_changes: { weight: 30, enabled: true, threshold: 1 },
    incomplete_section: { weight: 10, enabled: true, threshold: 3 },
  },
};

/** What one signal is worth here, falling back to the shipped model for a code nobody has. */
export function weightOf(policy: RiskPolicy, code: string): number {
  const signal = policy.signals[code] ?? DEFAULT_RISK_POLICY.signals[code];
  return signal === undefined || !signal.enabled ? 0 : signal.weight;
}

/** Whether this signal is counted at all. A disabled signal is not raised, not just unweighted. */
export function signalOn(policy: RiskPolicy, code: string): boolean {
  return (policy.signals[code] ?? DEFAULT_RISK_POLICY.signals[code])?.enabled ?? true;
}

/** The number a signal's condition compares against, with the shipped one as the fallback. */
export function thresholdOf(policy: RiskPolicy, code: string, fallback: number): number {
  const signal = policy.signals[code] ?? DEFAULT_RISK_POLICY.signals[code];
  return signal?.threshold ?? fallback;
}

interface PolicyRow {
  code: string;
  weight: number;
  enabled: boolean;
  threshold: string | null;
  tenant_enabled: boolean | null;
  tenant_weight: number | null;
  tenant_threshold: string | null;
}

interface BandRow {
  high_from: number;
  medium_from: number;
}

/**
 * The policy in force for this subscriber: the platform's model, with their disagreements.
 *
 * One query for the signals and one for the bands, both read on the subscriber's own
 * connection, so row level security is what keeps one subscriber's opinions out of another's
 * score rather than a WHERE clause the caller has to remember.
 */
export async function resolveRiskPolicy(tx: TenantTransaction): Promise<RiskPolicy> {
  const [signals, bands] = [
    await tx.query<PolicyRow>(
      `SELECT s.code, s.weight, s.enabled, s.threshold::text AS threshold,
              t.enabled AS tenant_enabled, t.weight AS tenant_weight,
              t.threshold::text AS tenant_threshold
         FROM risk_signals s
         LEFT JOIN tenant_risk_signals t
           ON t.signal_code = s.code AND t.tenant_id = $1
        ORDER BY s.position, s.code`,
      [tx.tenantId],
    ),
    await tx.query<BandRow>(
      `SELECT COALESCE(t.risk_high_from, p.risk_high_from) AS high_from,
              COALESCE(t.risk_medium_from, p.risk_medium_from) AS medium_from
         FROM platform_settings p
         LEFT JOIN tenant_risk_settings t ON t.tenant_id = $1`,
      [tx.tenantId],
    ),
  ];

  if (signals.rows.length === 0) {
    return DEFAULT_RISK_POLICY;
  }

  const resolved: Record<string, RiskSignalPolicy> = {};
  for (const row of signals.rows) {
    const threshold = row.tenant_threshold ?? row.threshold;
    resolved[row.code] = {
      weight: row.tenant_weight ?? row.weight,
      enabled: row.tenant_enabled ?? row.enabled,
      threshold: threshold === null ? null : Number(threshold),
    };
  }

  const band = bands.rows[0];
  return {
    signals: resolved,
    highFrom: band?.high_from ?? DEFAULT_RISK_POLICY.highFrom,
    mediumFrom: band?.medium_from ?? DEFAULT_RISK_POLICY.mediumFrom,
  };
}

/** The platform's model alone, for a caller with no subscriber: the panel, and the worker. */
export async function platformRiskPolicy(db: Queryable): Promise<RiskPolicy> {
  const [signals, bands] = [
    await db.query<Pick<PolicyRow, 'code' | 'weight' | 'enabled' | 'threshold'>>(
      `SELECT code, weight, enabled, threshold::text AS threshold
         FROM risk_signals ORDER BY position, code`,
    ),
    await db.query<BandRow>(
      `SELECT risk_high_from AS high_from, risk_medium_from AS medium_from FROM platform_settings`,
    ),
  ];
  if (signals.rows.length === 0) {
    return DEFAULT_RISK_POLICY;
  }
  const resolved: Record<string, RiskSignalPolicy> = {};
  for (const row of signals.rows) {
    resolved[row.code] = {
      weight: row.weight,
      enabled: row.enabled,
      threshold: row.threshold === null ? null : Number(row.threshold),
    };
  }
  const band = bands.rows[0];
  return {
    signals: resolved,
    highFrom: band?.high_from ?? DEFAULT_RISK_POLICY.highFrom,
    mediumFrom: band?.medium_from ?? DEFAULT_RISK_POLICY.mediumFrom,
  };
}
