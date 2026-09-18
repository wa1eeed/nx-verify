import type { Queryable } from '@nx-verify/db';
import { NxError } from '../errors.js';
import type { CustomerKind, ProfileSection } from '../customers/checks.js';
import { recordOperatorAudit } from '../operators/audit.js';
import { operatorCan, type OperatorIdentity } from '../operators/accounts.js';

/**
 * How verification behaves for every subscriber (handoff screen 05, «إعدادات التحقق»).
 *
 * Four figures and a table, set by staff and read everywhere:
 *
 *   max attempts          how many times a check that cannot reach the authority is tried
 *                         before it is reported failed. No attempt is charged.
 *   result validity       how long a fact no freshness policy names counts as current. The
 *                         profile view ages facts against it on read (ADR-007, ADR-117).
 *   name match threshold  the share of an account holder's name that must match the
 *                         customer's for the account to count as theirs.
 *   registry alert days   how early a registry about to lapse is flagged on the file.
 *
 * And which sections a file of each kind needs, in order. The registry section is the
 * anchor of every file (ADR-114) and stays required.
 */

export interface PlatformSettings {
  maxAttempts: number;
  resultValidityDays: number;
  nameMatchThresholdPct: number;
  registryAlertDays: number;
  /**
   * Whether a subscriber's own users are asked for a mailed code after their password
   * (ADR-143). Off until somebody turns it on, and it fails closed: turn it off here if mail
   * is down. The panel's own second step is an authenticator and does not depend on mail.
   */
  userSecondStep: 'off' | 'email';
  /**
   * The account a subscriber transfers to (ADR-158).
   *
   * Here rather than in the deployment's environment, because it is printed on the screen of
   * every subscriber who buys credit and an IBAN only one engineer can change is an outage
   * waiting for a bank merger. Not a secret, and not covered by rule 4: that rule protects the
   * identifiers of the people being verified, and this is our own account number.
   */
  bankAccountName: string | null;
  bankName: string | null;
  bankIban: string | null;
  transferNote: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  maxAttempts: 2,
  resultValidityDays: 90,
  nameMatchThresholdPct: 85,
  registryAlertDays: 30,
  userSecondStep: 'off',
  bankAccountName: null,
  bankName: null,
  bankIban: null,
  transferNote: null,
  updatedAt: null,
  updatedBy: null,
};

const LIMITS = {
  maxAttempts: [1, 5],
  resultValidityDays: [1, 3650],
  nameMatchThresholdPct: [50, 100],
  registryAlertDays: [1, 365],
} as const satisfies Record<string, readonly [number, number]>;

export async function getPlatformSettings(db: Queryable): Promise<PlatformSettings> {
  const { rows } = await db.query<{
    max_attempts: number;
    result_validity_days: number;
    name_match_threshold_pct: number;
    registry_alert_days: number;
    user_second_step: 'off' | 'email';
    bank_account_name: string | null;
    bank_name: string | null;
    bank_iban: string | null;
    transfer_note: string | null;
    updated_at: Date;
    updated_by: string | null;
  }>(
    `SELECT max_attempts, result_validity_days, name_match_threshold_pct, registry_alert_days,
            user_second_step, bank_account_name, bank_name, bank_iban, transfer_note,
            updated_at, updated_by
     FROM platform_settings WHERE id`,
  );
  const row = rows[0];
  return row
    ? {
        maxAttempts: row.max_attempts,
        resultValidityDays: row.result_validity_days,
        nameMatchThresholdPct: row.name_match_threshold_pct,
        registryAlertDays: row.registry_alert_days,
        userSecondStep: row.user_second_step,
        bankAccountName: row.bank_account_name,
        bankName: row.bank_name,
        bankIban: row.bank_iban,
        transferNote: row.transfer_note,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
      }
    : DEFAULT_PLATFORM_SETTINGS;
}

export type PlatformSettingsChange = Partial<
  Pick<
    PlatformSettings,
    'userSecondStep' | 'bankAccountName' | 'bankName' | 'bankIban' | 'transferNote'
  >
> &
  Pick<
    PlatformSettings,
    'maxAttempts' | 'resultValidityDays' | 'nameMatchThresholdPct' | 'registryAlertDays'
  >;

/** Spaces and case as a person types them, digits as the bank stores them. */
export function normaliseIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export async function setPlatformSettings(
  db: Queryable,
  actor: OperatorIdentity,
  change: PlatformSettingsChange,
): Promise<PlatformSettings> {
  if (!operatorCan(actor.role, 'settings')) {
    throw new NxError('NX-4031', { detail: 'this role does not change verification settings' });
  }
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const value = change[key as keyof typeof LIMITS];
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new NxError('NX-4002', {
        detail: `${key} must be a whole number from ${min} to ${max}`,
      });
    }
  }
  const secondStep = change.userSecondStep ?? 'off';
  if (secondStep !== 'off' && secondStep !== 'email') {
    throw new NxError('NX-4002', { detail: 'userSecondStep is off or email' });
  }
  // A wrong IBAN here sends every subscriber's money to nobody, so it is checked in the shape
  // the Kingdom uses rather than accepted as any string and discovered by a failed transfer.
  const iban = change.bankIban === null || change.bankIban === undefined
    ? null
    : normaliseIban(change.bankIban);
  if (iban !== null && iban !== '' && !/^SA[0-9]{22}$/.test(iban)) {
    throw new NxError('NX-4002', { detail: 'a Saudi IBAN is SA and twenty two digits' });
  }
  const before = await getPlatformSettings(db);
  await db.query(
    `UPDATE platform_settings
     SET max_attempts = $1, result_validity_days = $2, name_match_threshold_pct = $3,
         registry_alert_days = $4, user_second_step = $6,
         bank_account_name = $7, bank_name = $8, bank_iban = $9, transfer_note = $10,
         updated_at = now(), updated_by = $5
     WHERE id`,
    [
      change.maxAttempts,
      change.resultValidityDays,
      change.nameMatchThresholdPct,
      change.registryAlertDays,
      actor.id,
      secondStep,
      blankToNull(change.bankAccountName),
      blankToNull(change.bankName),
      iban === '' ? null : iban,
      blankToNull(change.transferNote),
    ],
  );
  const changed: Record<string, { from: unknown; to: unknown }> = Object.fromEntries(
    (Object.keys(LIMITS) as (keyof typeof LIMITS)[])
      .filter((key) => before[key] !== change[key])
      .map((key) => [key, { from: before[key], to: change[key] }]),
  );
  if (before.userSecondStep !== secondStep) {
    changed['userSecondStep'] = { from: before.userSecondStep, to: secondStep };
  }
  // The account is audited as changed or not, and never with the number in the entry: a trail
  // is read by more people, and for longer, than the screen is.
  const nextIban = iban === '' ? null : iban;
  if (before.bankIban !== nextIban) {
    changed['bankIban'] = {
      from: before.bankIban === null ? 'unset' : 'set',
      to: nextIban === null ? 'unset' : 'set',
    };
  }
  if (Object.keys(changed).length > 0) {
    await recordOperatorAudit(db, {
      operatorId: actor.id,
      action: 'settings.updated',
      target: 'settings:verification',
      metadata: changed,
    });
  }
  return getPlatformSettings(db);
}

export type Requirement = 'REQUIRED' | 'OPTIONAL' | 'NOT_APPLICABLE';

export interface SectionRequirementRow {
  kind: CustomerKind;
  section: ProfileSection;
  requirement: Requirement;
  position: number;
}

export type Layouts = Readonly<
  Record<CustomerKind, readonly (readonly [ProfileSection, Requirement])[]>
>;

export async function listSectionRequirements(db: Queryable): Promise<SectionRequirementRow[]> {
  const { rows } = await db.query<SectionRequirementRow>(
    `SELECT kind, section, requirement, position FROM section_requirements ORDER BY kind, position`,
  );
  return rows;
}

/** The sections of each kind of file, in order, from the rows. */
export function layoutsOf(rows: readonly SectionRequirementRow[]): Layouts {
  const layout = (kind: CustomerKind) =>
    rows
      .filter((row) => row.kind === kind)
      .sort((left, right) => left.position - right.position)
      .map((row) => [row.section, row.requirement] as const);
  return {
    COMPANY: layout('COMPANY'),
    ESTABLISHMENT: layout('ESTABLISHMENT'),
    FREELANCER: layout('FREELANCER'),
  };
}

export async function setSectionRequirement(
  db: Queryable,
  actor: OperatorIdentity,
  input: { kind: CustomerKind; section: ProfileSection; requirement: Requirement },
): Promise<void> {
  if (!operatorCan(actor.role, 'settings')) {
    throw new NxError('NX-4031', { detail: 'this role does not change verification settings' });
  }
  if (!['REQUIRED', 'OPTIONAL', 'NOT_APPLICABLE'].includes(input.requirement)) {
    throw new NxError('NX-4002', { detail: 'unknown requirement' });
  }
  if (input.section === 'REGISTRY' && input.requirement !== 'REQUIRED') {
    throw new NxError('NX-4002', { detail: 'the basic data section anchors every file' });
  }
  const { rowCount } = await db.query(
    `UPDATE section_requirements SET requirement = $3, updated_at = now(), updated_by = $4
     WHERE kind = $1 AND section = $2 AND requirement <> $3`,
    [input.kind, input.section, input.requirement, actor.id],
  );
  if ((rowCount ?? 0) > 0) {
    await recordOperatorAudit(db, {
      operatorId: actor.id,
      action: 'settings.section',
      target: 'settings:sections',
      metadata: { kind: input.kind, section: input.section, requirement: input.requirement },
    });
  }
}

export interface SettableSection {
  section: ProfileSection;
  requirement: 'REQUIRED' | 'OPTIONAL';
  /** The anchor of every file: listed, and never made optional. */
  fixed: boolean;
}

/**
 * The sections staff set for each kind of file (handoff screen 05, «الأقسام المطلوبة»).
 *
 * A section is listed for a kind when that kind's file has it and a check on the catalogue
 * fills it for that kind. A section no check fills is not a choice anybody can make: requiring
 * it would leave every such file incomplete for ever.
 */
export async function listSettableSections(
  db: Queryable,
): Promise<Record<CustomerKind, SettableSection[]>> {
  const layouts = layoutsOf(await listSectionRequirements(db));
  const { rows } = await db.query<{ kind: CustomerKind; section: ProfileSection }>(
    `SELECT DISTINCT kind, profile_section AS section
     FROM products, unnest(applies_to) AS kind
     WHERE profile_section IS NOT NULL AND status <> 'retired'`,
  );
  const filled = new Set(rows.map((row) => `${row.kind}:${row.section}`));
  const settable = (kind: CustomerKind): SettableSection[] =>
    layouts[kind]
      .filter(
        ([section, requirement]) =>
          requirement !== 'NOT_APPLICABLE' && filled.has(`${kind}:${section}`),
      )
      .map(([section, requirement]) => ({
        section,
        requirement: requirement === 'REQUIRED' ? 'REQUIRED' : 'OPTIONAL',
        fixed: section === 'REGISTRY',
      }));
  return {
    COMPANY: settable('COMPANY'),
    ESTABLISHMENT: settable('ESTABLISHMENT'),
    FREELANCER: settable('FREELANCER'),
  };
}


function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}
