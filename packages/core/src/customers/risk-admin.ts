import type { Queryable } from '@nx-verify/db';
import { NxError } from '../errors.js';

/**
 * Editing the risk model from the panel (ADR-138).
 *
 * Two levels, and the difference between them is the whole design. The platform's row says
 * what we believe; a subscriber's row says what they believe instead, field by field, and a
 * field they have no opinion about keeps inheriting ours. Nothing is copied onto a subscriber,
 * so improving a default reaches everybody who never disagreed.
 *
 * Operator surface: every function takes the operator connection. These tables say what a
 * score is made of, never whom anybody verified (guard 02).
 */

export type RiskCategory = 'STATUS' | 'MISMATCH' | 'INTERSECTION' | 'INCOMPLETE' | 'CHANGE' | 'AGE';
export type RiskSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface RiskSignalRow {
  code: string;
  nameAr: string;
  category: RiskCategory;
  severity: RiskSeverity;
  weight: number;
  enabled: boolean;
  threshold: number | null;
  thresholdLabelAr: string | null;
  /** The verification service whose answers it reads. Null for one that reads no single service. */
  productCode: string | null;
  productNameAr: string | null;
  position: number;
  /** Subscribers who have written their own opinion about this signal. */
  overrides: number;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface RiskBands {
  highFrom: number;
  mediumFrom: number;
}

export interface RiskModel {
  bands: RiskBands;
  signals: RiskSignalRow[];
}

/** The platform's model: every signal, what it weighs, and how many subscribers disagree. */
export async function riskModel(operator: Queryable): Promise<RiskModel> {
  const [{ rows: signals }, { rows: bands }] = [
    await operator.query<{
      code: string;
      name_ar: string;
      category: RiskCategory;
      severity: RiskSeverity;
      weight: number;
      enabled: boolean;
      threshold: string | null;
      threshold_label_ar: string | null;
      product_code: string | null;
      product_name_ar: string | null;
      position: number;
      overrides: string;
      updated_at: Date;
      updated_by: string | null;
    }>(
      `SELECT s.code, s.name_ar, s.category, s.severity, s.weight, s.enabled,
              s.threshold::text AS threshold, s.threshold_label_ar,
              s.product_code, p.name_ar AS product_name_ar, s.position,
              s.updated_at, s.updated_by,
              (SELECT count(*) FROM tenant_risk_signals t WHERE t.signal_code = s.code) AS overrides
         FROM risk_signals s
         LEFT JOIN products p ON p.code = s.product_code
        ORDER BY s.position, s.code`,
    ),
    await operator.query<{ high_from: number; medium_from: number }>(
      `SELECT risk_high_from AS high_from, risk_medium_from AS medium_from FROM platform_settings`,
    ),
  ];

  return {
    bands: {
      highFrom: bands[0]?.high_from ?? 60,
      mediumFrom: bands[0]?.medium_from ?? 30,
    },
    signals: signals.map((row) => ({
      code: row.code,
      nameAr: row.name_ar,
      category: row.category,
      severity: row.severity,
      weight: row.weight,
      enabled: row.enabled,
      threshold: row.threshold === null ? null : Number(row.threshold),
      thresholdLabelAr: row.threshold_label_ar,
      productCode: row.product_code,
      productNameAr: row.product_name_ar,
      position: row.position,
      overrides: Number(row.overrides),
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    })),
  };
}

function refuse(detail: string, cause: string): never {
  throw new NxError('NX-4002', { detail, cause });
}

function whole(value: number | undefined, name: string, low: number, high: number): number | null {
  if (value === undefined) {
    return null;
  }
  if (!Number.isInteger(value) || value < low || value > high) {
    refuse(`${name} must be a whole number between ${low} and ${high}`, `${name} خارج المدى.`);
  }
  return value;
}

export interface SetRiskSignalInput {
  code: string;
  weight?: number;
  enabled?: boolean;
  threshold?: number;
}

/** Changes what one signal is worth for everybody, or switches it off. */
export async function setRiskSignal(
  operator: Queryable,
  input: SetRiskSignalInput,
  actorId: string,
): Promise<void> {
  const weight = whole(input.weight, 'الوزن', 0, 100);
  const threshold = input.threshold === undefined ? null : input.threshold;
  if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0)) {
    refuse('threshold must be a number at or above zero', 'العتبة يجب أن تكون رقماً موجباً.');
  }

  const { rows } = await operator.query<{ code: string; threshold: string | null }>(
    `SELECT code, threshold::text AS threshold FROM risk_signals WHERE code = $1`,
    [input.code],
  );
  const current = rows[0];
  if (!current) {
    throw new NxError('NX-4041', {
      detail: `No such risk signal: ${input.code}`,
      cause: 'لا يوجد مؤشر بهذا الرمز.',
    });
  }
  // A signal with no number to compare against cannot be given one from a screen: the
  // condition that reads it is code, and a threshold nothing reads is a lie on a form.
  if (threshold !== null && current.threshold === null) {
    refuse(`Signal ${input.code} has no threshold`, 'هذا المؤشر بلا عتبة قابلة للضبط.');
  }

  await operator.query(
    `UPDATE risk_signals
        SET weight = COALESCE($2, weight),
            enabled = COALESCE($3, enabled),
            threshold = COALESCE($4::numeric, threshold),
            updated_at = now(),
            updated_by = $5
      WHERE code = $1`,
    [input.code, weight, input.enabled ?? null, threshold, actorId],
  );

  await operator.query(
    `INSERT INTO operator_audit (operator_id, action, target, metadata)
     VALUES ($1, 'risk.signal_set', $2, $3::jsonb)`,
    [
      actorId,
      `risk:${input.code}`,
      JSON.stringify({ weight, enabled: input.enabled ?? null, threshold }),
    ],
  );
}

/**
 * Switches risk scoring on or off for one verification service.
 *
 * The owner's unit, not ours: «stop letting the bank check move the score» is one decision,
 * and it reaches every signal that reads that service's answers. Written as those signals
 * rather than as a flag of its own, so there is one place a score is explained from.
 */
export async function setProductRisk(
  operator: Queryable,
  input: { productCode: string; enabled: boolean },
  actorId: string,
): Promise<number> {
  const { rowCount } = await operator.query(
    `UPDATE risk_signals SET enabled = $2, updated_at = now(), updated_by = $3
      WHERE product_code = $1`,
    [input.productCode, input.enabled, actorId],
  );
  if ((rowCount ?? 0) === 0) {
    throw new NxError('NX-4041', {
      detail: `No risk signal reads ${input.productCode}`,
      cause: 'لا مؤشر خطر يقرأ هذه الخدمة.',
    });
  }
  await operator.query(
    `INSERT INTO operator_audit (operator_id, action, target, metadata)
     VALUES ($1, 'risk.product_set', $2, $3::jsonb)`,
    [actorId, `risk:product:${input.productCode}`, JSON.stringify({ enabled: input.enabled, signals: rowCount })],
  );
  return rowCount ?? 0;
}

/** Moves the bands that turn a score into a word, for everybody. */
export async function setRiskBands(
  operator: Queryable,
  input: { highFrom: number; mediumFrom: number },
  actorId: string,
): Promise<void> {
  const high = whole(input.highFrom, 'حد الخطر العالي', 1, 100);
  const medium = whole(input.mediumFrom, 'حد الخطر المتوسط', 1, 100);
  if (high === null || medium === null || medium >= high) {
    refuse(
      'the medium band must start below the high band',
      'حد الخطر المتوسط يجب أن يكون أقل من حد الخطر العالي.',
    );
  }
  await operator.query(
    `UPDATE platform_settings
        SET risk_high_from = $1, risk_medium_from = $2, updated_at = now(), updated_by = $3`,
    [high, medium, actorId],
  );
  await operator.query(
    `INSERT INTO operator_audit (operator_id, action, target, metadata)
     VALUES ($1, 'risk.bands_set', 'risk:bands', $2::jsonb)`,
    [actorId, JSON.stringify({ high_from: high, medium_from: medium })],
  );
}

export type RiskSource = 'platform' | 'subscriber';

export interface TenantRiskSignalView extends RiskSignalRow {
  /** What is in force for this subscriber. */
  effectiveWeight: number;
  effectiveEnabled: boolean;
  effectiveThreshold: number | null;
  /** Where each of the three came from. */
  source: RiskSource;
  decidedBy: string | null;
  decidedAt: Date | null;
}

export interface TenantRiskModel {
  bands: RiskBands;
  bandsSource: RiskSource;
  platformBands: RiskBands;
  signals: TenantRiskSignalView[];
}

/** What one subscriber's model is, and for each part of it, whether they chose it or inherited it. */
export async function tenantRiskModel(
  operator: Queryable,
  tenantId: string,
): Promise<TenantRiskModel> {
  const platform = await riskModel(operator);
  const [{ rows: overrides }, { rows: bands }] = [
    await operator.query<{
      signal_code: string;
      enabled: boolean | null;
      weight: number | null;
      threshold: string | null;
      decided_by: string | null;
      decided_at: Date;
    }>(
      `SELECT signal_code, enabled, weight, threshold::text AS threshold, decided_by, decided_at
         FROM tenant_risk_signals WHERE tenant_id = $1`,
      [tenantId],
    ),
    await operator.query<{ high_from: number | null; medium_from: number | null }>(
      `SELECT risk_high_from AS high_from, risk_medium_from AS medium_from
         FROM tenant_risk_settings WHERE tenant_id = $1`,
      [tenantId],
    ),
  ];

  const byCode = new Map(overrides.map((row) => [row.signal_code, row]));
  const band = bands[0];

  return {
    platformBands: platform.bands,
    bands: {
      highFrom: band?.high_from ?? platform.bands.highFrom,
      mediumFrom: band?.medium_from ?? platform.bands.mediumFrom,
    },
    bandsSource:
      band?.high_from == null && band?.medium_from == null ? 'platform' : 'subscriber',
    signals: platform.signals.map((signal) => {
      const own = byCode.get(signal.code);
      return {
        ...signal,
        effectiveWeight: own?.weight ?? signal.weight,
        effectiveEnabled: own?.enabled ?? signal.enabled,
        effectiveThreshold:
          own?.threshold === undefined || own.threshold === null
            ? signal.threshold
            : Number(own.threshold),
        source: own === undefined ? 'platform' : 'subscriber',
        decidedBy: own?.decided_by ?? null,
        decidedAt: own?.decided_at ?? null,
      };
    }),
  };
}

export interface SetTenantRiskSignalInput {
  tenantId: string;
  code: string;
  /** Each null means «no opinion»: inherit the platform's answer for that one thing. */
  enabled?: boolean | null;
  weight?: number | null;
  threshold?: number | null;
}

/**
 * Writes one subscriber's disagreement with the platform's model, or lifts it.
 *
 * A row that overrides nothing is deleted rather than kept with three nulls, so «inherited» is
 * the absence of a row and a later change to the default reaches them again.
 */
export async function setTenantRiskSignal(
  operator: Queryable,
  input: SetTenantRiskSignalInput,
  actorId: string,
): Promise<void> {
  const weight = input.weight == null ? null : whole(input.weight, 'الوزن', 0, 100);
  const threshold = input.threshold ?? null;
  if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0)) {
    refuse('threshold must be a number at or above zero', 'العتبة يجب أن تكون رقماً موجباً.');
  }
  const enabled = input.enabled ?? null;

  const { rowCount } = await operator.query(`SELECT 1 FROM risk_signals WHERE code = $1`, [
    input.code,
  ]);
  if ((rowCount ?? 0) === 0) {
    throw new NxError('NX-4041', {
      detail: `No such risk signal: ${input.code}`,
      cause: 'لا يوجد مؤشر بهذا الرمز.',
    });
  }

  if (enabled === null && weight === null && threshold === null) {
    await operator.query(
      `DELETE FROM tenant_risk_signals WHERE tenant_id = $1 AND signal_code = $2`,
      [input.tenantId, input.code],
    );
  } else {
    await operator.query(
      `INSERT INTO tenant_risk_signals
         (tenant_id, signal_code, enabled, weight, threshold, decided_by)
       VALUES ($1, $2, $3, $4, $5::numeric, $6)
       ON CONFLICT (tenant_id, signal_code) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         weight = EXCLUDED.weight,
         threshold = EXCLUDED.threshold,
         decided_by = EXCLUDED.decided_by,
         decided_at = now()`,
      [input.tenantId, input.code, enabled, weight, threshold, actorId],
    );
  }

  await operator.query(
    `INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, target, metadata)
     VALUES ($1, 'NX_STAFF', $2, 'risk.signal_set', $3, $4::jsonb)`,
    [input.tenantId, actorId, `risk:${input.code}`, JSON.stringify({ enabled, weight, threshold })],
  );
}

/** Moves one subscriber's bands, or returns them to the platform's. */
export async function setTenantRiskBands(
  operator: Queryable,
  input: { tenantId: string; highFrom: number | null; mediumFrom: number | null },
  actorId: string,
): Promise<void> {
  const high = input.highFrom == null ? null : whole(input.highFrom, 'حد الخطر العالي', 1, 100);
  const medium =
    input.mediumFrom == null ? null : whole(input.mediumFrom, 'حد الخطر المتوسط', 1, 100);
  if (high !== null && medium !== null && medium >= high) {
    refuse(
      'the medium band must start below the high band',
      'حد الخطر المتوسط يجب أن يكون أقل من حد الخطر العالي.',
    );
  }

  if (high === null && medium === null) {
    await operator.query(`DELETE FROM tenant_risk_settings WHERE tenant_id = $1`, [input.tenantId]);
  } else {
    await operator.query(
      `INSERT INTO tenant_risk_settings (tenant_id, risk_high_from, risk_medium_from, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id) DO UPDATE SET
         risk_high_from = EXCLUDED.risk_high_from,
         risk_medium_from = EXCLUDED.risk_medium_from,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()`,
      [input.tenantId, high, medium, actorId],
    );
  }

  await operator.query(
    `INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, target, metadata)
     VALUES ($1, 'NX_STAFF', $2, 'risk.bands_set', 'risk:bands', $3::jsonb)`,
    [input.tenantId, actorId, JSON.stringify({ high_from: high, medium_from: medium })],
  );
}
