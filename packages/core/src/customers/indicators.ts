import type { Freshness } from '../repositories/profile.js';
import type { CustomerKind } from './checks.js';
import { daysCount, detectedChanges, otherBusinesses, otherCustomers } from './arabic.js';
import {
  DEFAULT_RISK_POLICY,
  signalOn,
  thresholdOf,
  weightOf,
  type RiskPolicy,
} from './risk-policy.js';

/**
 * The KYB and KYC indicators of a customer file, and the signals worth a person's time.
 *
 * Every figure here can be explained in one sentence from facts on the file, and is. There
 * is no model and no weight a reader cannot see: a compliance officer who is shown "high
 * risk" is shown the lines that made it high, each with its weight, because a verdict
 * without its reason is one nobody can act on or defend to an auditor.
 *
 * Indicators say what has been established. Reasons say what deserves attention and what it
 * costs: the risk score (handoff screen 03) is their weights added, up to one hundred, and its
 * level is the band that sum falls in. Every weight, threshold and band is a row a subscriber
 * may disagree with (ADR-138, migration 0052), so no number is written here except as the
 * model we ship in `risk-policy.ts`. Nothing is rated until the anchor fact has been checked:
 * an unverified company is not a low risk company.
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

type SignalSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * A signal on its way to becoming a reason.
 *
 * Internal, and it stays internal. It used to be carried out of here on the assessment beside
 * `riskReasons`, which no screen ever drew: the same sentences twice, one list ordered by the
 * platform's opinion of severity and one by the weight that actually makes the score. A reader
 * is shown the weights, so the weights are the list.
 */
interface RiskSignal {
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
  /**
   * Where this subscriber's bands fall (ADR-138). Carried with the assessment so every screen
   * reading it draws the same lines: a weight that reads as «worth a look» to one subscriber
   * is an ordinary one to another, and a second copy of the number drifts.
   */
  bands: { highFrom: number; mediumFrom: number };
  /** Zero to one hundred. Null until there is anything to rate. */
  riskScore: number | null;
  /**
   * Every signal that counts against this customer and what each adds, heaviest first. The
   * whole of what the score is made of: there is no second list with anything else in it.
   */
  riskReasons: RiskReason[];
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
  /** The name match an account needs to count as the customer's (screen 05). 85 when absent. */
  nameMatchThresholdPct?: number;
  /**
   * What each signal weighs here, what is counted at all, and where the bands fall
   * (ADR-138). Absent means the shipped model, so this stays callable without a database.
   */
  riskPolicy?: RiskPolicy;
  now: Date;
}

/** The policy in force for this assessment: the subscriber's, or the one we ship. */
function policyOf(input: AssessmentInput): RiskPolicy {
  return input.riskPolicy ?? DEFAULT_RISK_POLICY;
}

/**
 * Whether the account holder is the customer, with the platform's threshold applied.
 *
 * The authority says match, partial or no match, and gives the share of the name that
 * matched. The share is held to the threshold staff set: under it the account is a partial
 * match whatever the label, and at or over it a match. An account in another name stays one.
 */
function bankOwnershipOf(input: AssessmentInput): FactView | undefined {
  const ownership = fact(input, 'bank.iban_ownership');
  if (ownership === undefined || ownership.value === 'NO_MATCH') {
    return ownership;
  }
  const raw = fact(input, 'bank.match_score')?.value;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return ownership;
  }
  const pct = raw <= 1 ? raw * 100 : raw;
  return { ...ownership, value: pct >= (input.nameMatchThresholdPct ?? 85) ? 'MATCH' : 'PARTIAL' };
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
 * Which band a score falls in.
 *
 * The two numbers are a subscriber's to set: a lender calls sixty high, and a marketplace
 * selling stationery may not. Without a policy they are the ones the platform shipped.
 */
export function riskLevelFor(
  score: number,
  policy: RiskPolicy = DEFAULT_RISK_POLICY,
): Exclude<RiskLevel, 'INCOMPLETE'> {
  return score >= policy.highFrom ? 'HIGH' : score >= policy.mediumFrom ? 'MEDIUM' : 'LOW';
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
  const ownership = bankOwnershipOf(input);
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
    bankItem(bankOwnershipOf(input), fact(input, 'bank.account_status')),
  ];
}

function signalsFor(input: AssessmentInput): RiskSignal[] {
  const policy = policyOf(input);
  const signals: RiskSignal[] = [];
  // A signal switched off is not raised at all, rather than raised and weighed zero: what the
  // reader is shown and what the score is made of must be the same list (ADR-138).
  const raise = (signal: RiskSignal): void => {
    if (signalOn(policy, signal.key)) {
      signals.push(signal);
    }
  };
  const status = fact(input, 'cr.status_code');
  if (status !== undefined && status.value !== 1) {
    raise({
      key: 'registry_inactive',
      severity: 'HIGH',
      textAr: `السجل التجاري غير فعّال: ${String(fact(input, 'cr.status')?.value ?? '')}.`,
    });
  }
  if (fact(input, 'cr.in_liquidation')?.value === true) {
    raise({ key: 'liquidation', severity: 'HIGH', textAr: 'المنشأة في مرحلة التصفية.' });
  }
  const ownership = bankOwnershipOf(input)?.value;
  if (ownership === 'NO_MATCH') {
    raise({
      key: 'iban_mismatch',
      severity: 'HIGH',
      textAr: 'الحساب البنكي المقدَّم مسجل باسم آخر.',
    });
  } else if (ownership === 'PARTIAL') {
    raise({
      key: 'iban_partial',
      severity: 'MEDIUM',
      textAr: 'تطابق جزئي فقط بين اسم العميل واسم صاحب الحساب.',
    });
  }
  const account = fact(input, 'bank.account_status')?.value;
  if (account !== undefined && account !== 'ACTIVE') {
    raise({ key: 'account_inactive', severity: 'MEDIUM', textAr: 'الحساب البنكي غير نشط.' });
  }
  const certificate = fact(input, 'freelance.certificate_status')?.value;
  if (certificate !== undefined && certificate !== 'ACTIVE') {
    raise({
      key: 'certificate_inactive',
      severity: 'HIGH',
      textAr: 'وثيقة العمل الحر غير سارية.',
    });
  }
  if (fact(input, 'freelance.ownership')?.value === 'NOT_VERIFIED') {
    raise({
      key: 'certificate_not_owned',
      severity: 'HIGH',
      textAr: 'وثيقة العمل الحر لا تعود لصاحب الهوية.',
    });
  }

  const issued = fact(input, 'cr.issue_date')?.value;
  if (typeof issued === 'string') {
    const age = daysBetween(new Date(issued), input.now);
    if (age >= 0 && age < thresholdOf(policy, 'new_business', 180)) {
      raise({
        key: 'new_business',
        severity: 'LOW',
        textAr: `منشأة حديثة التأسيس: صدر سجلها قبل ${daysCount(age)}.`,
      });
    }
  }

  for (const manager of input.managers) {
    if (manager.otherCompanies >= thresholdOf(policy, 'manager_many_companies', 3)) {
      raise({
        key: 'manager_many_companies',
        severity: 'MEDIUM',
        textAr: `${manager.name ?? 'أحد المدراء'} يدير ${otherBusinesses(manager.otherCompanies)} من عملائك.`,
      });
    }
  }
  if (input.accountsSharedWith >= thresholdOf(policy, 'shared_account', 1)) {
    raise({
      key: 'shared_account',
      severity: 'HIGH',
      textAr: `الحساب البنكي نفسه مقدَّم أيضاً إلى ${otherCustomers(input.accountsSharedWith)} لديك.`,
    });
  }
  if (input.addressSharedWith >= thresholdOf(policy, 'shared_address', 1)) {
    raise({
      key: 'shared_address',
      severity: 'LOW',
      textAr: `العنوان الوطني نفسه مسجل باسم ${otherBusinesses(input.addressSharedWith)} من عملائك.`,
    });
  }
  if (input.openChanges >= thresholdOf(policy, 'open_changes', 1)) {
    raise({
      key: 'open_changes',
      severity: 'MEDIUM',
      textAr: `${detectedChanges(input.openChanges)} بانتظار الاطلاع.`,
    });
  }

  // Severity decides nothing about the score and everything about a tie in it: the reasons are
  // sorted by weight with a stable sort, so two signals worth thirty are read in the order the
  // platform thinks they matter rather than in the order the conditions happen to be written.
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

  const policy = policyOf(input);
  // How many unfilled sections are counted before the rest stop adding. A file missing five
  // sections is not five times riskier than one missing a section: it is a file nobody has
  // finished reading.
  const sectionsCounted = signalOn(policy, 'incomplete_section')
    ? thresholdOf(policy, 'incomplete_section', 3)
    : 0;

  const riskReasons: RiskReason[] = [
    ...signals.map((signal) => ({
      key: signal.key,
      weight: weightOf(policy, signal.key),
      textAr: signal.textAr,
    })),
    ...(input.incompleteSections ?? []).slice(0, sectionsCounted).map((title) => ({
      key: 'incomplete_section',
      weight: weightOf(policy, 'incomplete_section'),
      textAr: `قسم ${title} لم يكتمل بعد`,
    })),
  ]
    .filter((reason) => reason.weight > 0)
    .sort((left, right) => right.weight - left.weight);

  const rated = anchor !== undefined && known > 0;
  const signalWeight = signals.reduce((sum, signal) => sum + weightOf(policy, signal.key), 0);
  const riskScore =
    rated || signalWeight > 0
      ? Math.min(
          100,
          riskReasons.reduce((sum, reason) => sum + reason.weight, 0),
        )
      : null;
  const riskLevel: RiskLevel = riskScore === null ? 'INCOMPLETE' : riskLevelFor(riskScore, policy);

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
    bands: { highFrom: policy.highFrom, mediumFrom: policy.mediumFrom },
    standingAr: STANDING_LABELS[standing],
    riskLevel,
    riskLabelAr: RISK_LABELS[riskLevel],
    riskScore,
    riskReasons,
  };
}
