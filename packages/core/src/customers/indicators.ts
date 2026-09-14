import type { Freshness } from '../repositories/profile.js';
import type { CustomerKind } from './checks.js';
import { daysCount, detectedChanges, otherBusinesses, otherCustomers } from './arabic.js';

/**
 * The KYB and KYC indicators of a customer file, and the signals worth a person's time.
 *
 * Every figure here can be explained in one sentence from facts on the file, and is. There
 * is no model and no weight a reader cannot see: a compliance officer who is shown "high
 * risk" is shown the lines that made it high, each with its weight, because a verdict
 * without its reason is one nobody can act on or defend to an auditor.
 *
 * Indicators say what has been established. Signals say what deserves attention. The risk
 * score (handoff screen 03) adds the signals' weights and ten for each required section
 * still missing, up to one hundred; its level is the band the score falls in. A signal the
 * product treats as serious weighs sixty, so it alone makes the level high. Nothing is rated
 * until the anchor fact has been checked: an unverified company is not a low risk company.
 */

export type IndicatorState = 'PASS' | 'FAIL' | 'WARN' | 'UNKNOWN' | 'NA';

export interface Indicator {
  key: string;
  labelAr: string;
  /** A few words for the indicator when it passes, for a line of reasons. */
  shortAr: string;
  state: IndicatorState;
  detailAr: string | null;
}

export type SignalSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface RiskSignal {
  key: string;
  severity: SignalSeverity;
  textAr: string;
}

export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INCOMPLETE';

export interface RiskReason {
  key: string;
  /** What this reason adds to the score. */
  weight: number;
  textAr: string;
}

/**
 * Where the file stands, in the word the handoff uses: complete, deficient (a verified fact
 * failed), or still being completed.
 */
export type Standing = 'COMPLETE' | 'DEFICIENT' | 'IN_PROGRESS';

export interface Assessment {
  mode: 'KYB' | 'KYC';
  items: Indicator[];
  passed: number;
  applicable: number;
  /** Verified, partly verified, or not verified, in words. */
  statusAr: string;
  statusTone: 'fresh' | 'neutral' | 'critical';
  standing: Standing;
  standingAr: string;
  riskLevel: RiskLevel;
  riskLabelAr: string;
  /** Zero to one hundred. Null until there is anything to rate. */
  riskScore: number | null;
  /** The weights that make the score, heaviest first. */
  riskReasons: RiskReason[];
  signals: RiskSignal[];
}

export interface FactView {
  value: unknown;
  freshness: Freshness;
  observedAt: Date;
}

export interface AssessmentInput {
  kind: CustomerKind | null;
  isFreelancer: boolean;
  facts: ReadonlyMap<string, FactView>;
  managers: { name: string | null; hasPermissions: boolean; otherCompanies: number }[];
  accountsSharedWith: number;
  addressSharedWith: number;
  openChanges: number;
  /** The required sections of the file that are not complete yet, by title. */
  incompleteSections?: readonly string[];
  now: Date;
}

/** The handoff's words for the score's level: «درجة المخاطر» is feminine. */
const RISK_LABELS: Record<RiskLevel, string> = {
  HIGH: 'عالية',
  MEDIUM: 'متوسطة',
  LOW: 'منخفضة',
  INCOMPLETE: 'غير مكتملة',
};

const STANDING_LABELS: Record<Standing, string> = {
  COMPLETE: 'مستوفى',
  DEFICIENT: 'ناقص',
  IN_PROGRESS: 'قيد الإكمال',
};

/**
 * What each signal adds to the score.
 *
 * Serious signals weigh sixty, so one of them makes the level high on its own; the ones a
 * person should look at weigh thirty, the medium band's floor; the rest nudge.
 */
export const SIGNAL_WEIGHTS: Readonly<Record<string, number>> = {
  registry_inactive: 60,
  liquidation: 70,
  iban_mismatch: 60,
  iban_partial: 30,
  account_inactive: 30,
  certificate_inactive: 60,
  certificate_not_owned: 65,
  new_business: 10,
  manager_many_companies: 30,
  shared_account: 60,
  shared_address: 14,
  open_changes: 30,
};

/** Each required section still missing adds this much, for at most three of them. */
export const INCOMPLETE_SECTION_WEIGHT = 10;
const INCOMPLETE_SECTIONS_COUNTED = 3;

export function riskLevelFor(score: number): Exclude<RiskLevel, 'INCOMPLETE'> {
  return score >= 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW';
}

function fact(input: AssessmentInput, path: string): FactView | undefined {
  return input.facts.get(path);
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

function businessItems(input: AssessmentInput): Indicator[] {
  const status = fact(input, 'cr.status_code');
  const statusText = fact(input, 'cr.status');
  const liquidation = fact(input, 'cr.in_liquidation');
  const registryState: IndicatorState =
    status === undefined
      ? 'UNKNOWN'
      : status.value === 1 && liquidation?.value !== true
        ? status.freshness === 'expired'
          ? 'WARN'
          : 'PASS'
        : 'FAIL';

  const contract = [...input.facts.keys()].some((path) => path.startsWith('contract.'));
  const address = fact(input, 'address.national.city');
  const ownership = fact(input, 'bank.iban_ownership');
  const knownManagers = input.managers.length;
  const managersChecked = input.managers.filter((manager) => manager.hasPermissions).length;

  return [
    {
      key: 'registry_active',
      labelAr: 'السجل التجاري فعّال',
      shortAr: 'سجل ساري',
      state: registryState,
      detailAr:
        registryState === 'UNKNOWN'
          ? 'لم يُتحقق من السجل بعد.'
          : registryState === 'WARN'
            ? 'فعّال عند آخر تحقق، والمعلومة تجاوزت مدة صلاحيتها.'
            : registryState === 'FAIL'
              ? liquidation?.value === true
                ? 'المنشأة تحت التصفية.'
                : `حالة السجل: ${String(statusText?.value ?? 'غير فعّال')}.`
              : null,
    },
    {
      key: 'articles',
      labelAr: 'عقد التأسيس موثّق',
      shortAr: 'عقد موثّق',
      state: input.kind === 'ESTABLISHMENT' ? 'NA' : contract ? 'PASS' : 'UNKNOWN',
      detailAr:
        input.kind === 'ESTABLISHMENT'
          ? 'لا ينطبق على المؤسسة الفردية.'
          : contract
            ? null
            : 'لم يُتحقق من عقد التأسيس بعد.',
    },
    {
      key: 'managers_authority',
      labelAr: 'صلاحيات المدراء مثبتة',
      shortAr: 'صلاحيات مثبتة',
      state:
        knownManagers === 0
          ? 'UNKNOWN'
          : managersChecked === knownManagers
            ? 'PASS'
            : managersChecked > 0
              ? 'WARN'
              : 'UNKNOWN',
      detailAr:
        knownManagers === 0
          ? 'لا يُعرف المدراء بعد.'
          : managersChecked === knownManagers
            ? null
            : `تحققت صلاحيات ${managersChecked} من ${knownManagers} مدراء.`,
    },
    {
      key: 'national_address',
      labelAr: 'العنوان الوطني موثّق',
      shortAr: 'عنوان مُتحقق',
      state: address === undefined ? 'UNKNOWN' : address.freshness === 'expired' ? 'WARN' : 'PASS',
      detailAr:
        address === undefined
          ? 'لم يُتحقق من العنوان بعد.'
          : address.freshness === 'expired'
            ? 'تجاوز مدة صلاحيته.'
            : null,
    },
    bankItem(ownership, fact(input, 'bank.account_status')),
  ];
}

function bankItem(ownership: FactView | undefined, accountStatus: FactView | undefined): Indicator {
  if (ownership === undefined) {
    return {
      key: 'bank_account',
      labelAr: 'الحساب البنكي يعود للعميل',
      shortAr: 'حساب مطابق',
      state: 'UNKNOWN',
      detailAr: 'لم يُتحقق من أي حساب بنكي بعد.',
    };
  }
  if (ownership.value === 'MATCH') {
    const active = accountStatus === undefined || accountStatus.value === 'ACTIVE';
    return {
      key: 'bank_account',
      labelAr: 'الحساب البنكي يعود للعميل',
      shortAr: 'حساب مطابق',
      state: active ? 'PASS' : 'WARN',
      detailAr: active ? null : 'مطابق، لكن الحساب غير نشط.',
    };
  }
  return {
    key: 'bank_account',
    labelAr: 'الحساب البنكي يعود للعميل',
    shortAr: 'حساب مطابق',
    state: ownership.value === 'PARTIAL' ? 'WARN' : 'FAIL',
    detailAr:
      ownership.value === 'PARTIAL'
        ? 'تطابق جزئي بين الاسم واسم صاحب الحساب.'
        : 'الحساب مسجل باسم آخر.',
  };
}

function freelancerItems(input: AssessmentInput): Indicator[] {
  const ownership = fact(input, 'freelance.ownership');
  const status = fact(input, 'freelance.certificate_status');
  return [
    {
      key: 'certificate_owned',
      labelAr: 'الوثيقة تعود لصاحب الهوية',
      shortAr: 'وثيقة لصاحبها',
      state: ownership === undefined ? 'UNKNOWN' : ownership.value === 'VERIFIED' ? 'PASS' : 'FAIL',
      detailAr:
        ownership === undefined
          ? 'لم يُتحقق من الوثيقة بعد.'
          : ownership.value === 'VERIFIED'
            ? null
            : 'رقم الوثيقة لا يعود لهذه الهوية.',
    },
    {
      key: 'certificate_active',
      labelAr: 'وثيقة العمل الحر سارية',
      shortAr: 'وثيقة سارية',
      state:
        status === undefined
          ? 'UNKNOWN'
          : status.value === 'ACTIVE'
            ? status.freshness === 'expired'
              ? 'FAIL'
              : 'PASS'
            : 'FAIL',
      detailAr:
        status === undefined
          ? null
          : status.value !== 'ACTIVE'
            ? 'الوثيقة غير سارية.'
            : status.freshness === 'expired'
              ? 'انتهى تاريخ الوثيقة.'
              : null,
    },
    bankItem(fact(input, 'bank.iban_ownership'), fact(input, 'bank.account_status')),
  ];
}

function signalsFor(input: AssessmentInput): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const status = fact(input, 'cr.status_code');
  if (status !== undefined && status.value !== 1) {
    signals.push({
      key: 'registry_inactive',
      severity: 'HIGH',
      textAr: `السجل التجاري غير فعّال: ${String(fact(input, 'cr.status')?.value ?? '')}.`,
    });
  }
  if (fact(input, 'cr.in_liquidation')?.value === true) {
    signals.push({ key: 'liquidation', severity: 'HIGH', textAr: 'المنشأة في مرحلة التصفية.' });
  }
  const ownership = fact(input, 'bank.iban_ownership')?.value;
  if (ownership === 'NO_MATCH') {
    signals.push({
      key: 'iban_mismatch',
      severity: 'HIGH',
      textAr: 'الحساب البنكي المقدَّم مسجل باسم آخر.',
    });
  } else if (ownership === 'PARTIAL') {
    signals.push({
      key: 'iban_partial',
      severity: 'MEDIUM',
      textAr: 'تطابق جزئي فقط بين اسم العميل واسم صاحب الحساب.',
    });
  }
  const account = fact(input, 'bank.account_status')?.value;
  if (account !== undefined && account !== 'ACTIVE') {
    signals.push({ key: 'account_inactive', severity: 'MEDIUM', textAr: 'الحساب البنكي غير نشط.' });
  }
  const certificate = fact(input, 'freelance.certificate_status')?.value;
  if (certificate !== undefined && certificate !== 'ACTIVE') {
    signals.push({
      key: 'certificate_inactive',
      severity: 'HIGH',
      textAr: 'وثيقة العمل الحر غير سارية.',
    });
  }
  if (fact(input, 'freelance.ownership')?.value === 'NOT_VERIFIED') {
    signals.push({
      key: 'certificate_not_owned',
      severity: 'HIGH',
      textAr: 'وثيقة العمل الحر لا تعود لصاحب الهوية.',
    });
  }

  const issued = fact(input, 'cr.issue_date')?.value;
  if (typeof issued === 'string') {
    const age = daysBetween(new Date(issued), input.now);
    if (age >= 0 && age < 180) {
      signals.push({
        key: 'new_business',
        severity: 'LOW',
        textAr: `منشأة حديثة التأسيس: صدر سجلها قبل ${daysCount(age)}.`,
      });
    }
  }

  for (const manager of input.managers) {
    if (manager.otherCompanies >= 3) {
      signals.push({
        key: 'manager_many_companies',
        severity: 'MEDIUM',
        textAr: `${manager.name ?? 'أحد المدراء'} يدير ${otherBusinesses(manager.otherCompanies)} من عملائك.`,
      });
    }
  }
  if (input.accountsSharedWith > 0) {
    signals.push({
      key: 'shared_account',
      severity: 'HIGH',
      textAr: `الحساب البنكي نفسه مقدَّم أيضاً إلى ${otherCustomers(input.accountsSharedWith)} لديك.`,
    });
  }
  if (input.addressSharedWith >= 1) {
    signals.push({
      key: 'shared_address',
      severity: 'LOW',
      textAr: `العنوان الوطني نفسه مسجل باسم ${otherBusinesses(input.addressSharedWith)} من عملائك.`,
    });
  }
  if (input.openChanges > 0) {
    signals.push({
      key: 'open_changes',
      severity: 'MEDIUM',
      textAr: `${detectedChanges(input.openChanges)} بانتظار الاطلاع.`,
    });
  }

  const order: Record<SignalSeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return signals.sort((left, right) => order[left.severity] - order[right.severity]);
}

export function assessCustomer(input: AssessmentInput): Assessment {
  const mode = input.isFreelancer ? 'KYC' : 'KYB';
  const items = input.isFreelancer ? freelancerItems(input) : businessItems(input);
  const applicable = items.filter((item) => item.state !== 'NA').length;
  const passed = items.filter((item) => item.state === 'PASS').length;
  const known = items.filter((item) => item.state !== 'NA' && item.state !== 'UNKNOWN').length;
  const signals = signalsFor(input);

  // The anchor fact of a file: the registration for a business, the certificate for a
  // freelancer. Until it has been checked there is nothing to rate.
  const anchor = input.isFreelancer
    ? fact(input, 'freelance.certificate_status')
    : fact(input, 'cr.status_code');

  const riskReasons: RiskReason[] = [
    ...signals.map((signal) => ({
      key: signal.key,
      weight: SIGNAL_WEIGHTS[signal.key] ?? 0,
      textAr: signal.textAr,
    })),
    ...(input.incompleteSections ?? []).slice(0, INCOMPLETE_SECTIONS_COUNTED).map((title) => ({
      key: 'incomplete_section',
      weight: INCOMPLETE_SECTION_WEIGHT,
      textAr: `قسم ${title} لم يكتمل بعد`,
    })),
  ]
    .filter((reason) => reason.weight > 0)
    .sort((left, right) => right.weight - left.weight);

  const rated = anchor !== undefined && known > 0;
  const signalWeight = signals.reduce((sum, signal) => sum + (SIGNAL_WEIGHTS[signal.key] ?? 0), 0);
  const riskScore =
    rated || signalWeight > 0
      ? Math.min(
          100,
          riskReasons.reduce((sum, reason) => sum + reason.weight, 0),
        )
      : null;
  const riskLevel: RiskLevel = riskScore === null ? 'INCOMPLETE' : riskLevelFor(riskScore);

  const failed = items.some((item) => item.state === 'FAIL');
  const standing: Standing = failed
    ? 'DEFICIENT'
    : applicable > 0 && known === applicable
      ? 'COMPLETE'
      : 'IN_PROGRESS';

  return {
    mode,
    items,
    passed,
    applicable,
    statusAr: failed
      ? 'لم يجتز التحقق'
      : passed === applicable && applicable > 0
        ? 'موثّق'
        : passed > 0
          ? 'موثّق جزئياً'
          : 'غير موثّق',
    statusTone: failed ? 'critical' : passed === applicable && applicable > 0 ? 'fresh' : 'neutral',
    standing,
    standingAr: STANDING_LABELS[standing],
    riskLevel,
    riskLabelAr: RISK_LABELS[riskLevel],
    riskScore,
    riskReasons,
    signals,
  };
}
