import type {
  CustomerKind,
  LookupStatus,
  ProductState,
  RequestCheckStatus,
  RequestOutcome,
  RequestStatus,
} from '@nx-verify/core';
import type { TagTone } from '../ui/tag';
import { count, dayMonthAr, riyals } from '../format';

/**
 * What the request screen shows, worked out without React (handoff screen 02).
 *
 * The screen is a client component that polls, so everything it reads arrives as plain data
 * with dates as strings, and every decision about a row, the count and the total is a pure
 * function here. The rules are the README's: a product that does not apply to the kind of
 * customer is faded with its box empty and its button off; a product being checked says so
 * and cannot be pressed again; the price is hidden when the subscriber hides it; and «تحقق
 * من الكل» stops when the balance cannot pay for what is ticked.
 */

export const KIND_OPTIONS: readonly { value: CustomerKind; label: string }[] = [
  { value: 'COMPANY', label: 'شركة' },
  { value: 'ESTABLISHMENT', label: 'مؤسسة' },
  { value: 'FREELANCER', label: 'عامل حر' },
];

export function kindLabel(kind: CustomerKind): string {
  return KIND_OPTIONS.find((option) => option.value === kind)?.label ?? '';
}

/** One product of the catalogue, as the screen needs it. */
export interface ProductData {
  productCode: string;
  nameAr: string;
  nameEn: string;
  summaryAr: string | null;
  appliesTo: CustomerKind[];
  availability: 'AVAILABLE' | 'COMING_SOON';
  /** Per operation, before VAT. Null when no price is in force. */
  unitPriceHalalas: number | null;
  /**
   * The most one operation can be charged, before VAT, from the same quote. Equal to the price
   * above unless the plan reprices a run past its capacity, and the figure any sum of several
   * operations is built from (ADR-188).
   */
  ceilingUnitPriceHalalas: number | null;
  /** The subscriber's package includes it. */
  allowed: boolean;
  refusalAr: string | null;
  /** One operation for each manager the registry names. */
  perManager: boolean;
  needsIban: boolean;
  needsCertificate: boolean;
  /** Ticked when the screen opens: the first check of its section. */
  selectedByDefault: boolean;
}

export interface StandingData {
  productCode: string;
  state: ProductState;
  verifiedAt: string | null;
  issueAr: string | null;
  hasResult: boolean;
}

export interface LookupData {
  status: LookupStatus;
  entityId: string | null;
  displayName: string | null;
  /** The file's own number, masked, shown in the empty number field of a known customer. */
  identifier: string | null;
  kind: CustomerKind | null;
  account: string | null;
  managers: number;
  hasCertificate: boolean;
  standings: StandingData[];
}

export interface RequestCheckData {
  productCode: string;
  status: RequestCheckStatus;
  outcome: RequestOutcome | null;
  noteAr: string | null;
}

export interface RequestData {
  requestId: string;
  status: RequestStatus;
  entityId: string | null;
  displayName: string | null;
  open: boolean;
  checks: RequestCheckData[];
}

export interface DraftData {
  requestId: string;
  kind: CustomerKind;
  entityId: string | null;
  label: string;
  /** The number the draft was saved for, masked. Null when it was saved for a file. */
  subject: string | null;
  productCodes: string[];
  createdAt: string;
  iban: string | null;
  hasCertificate: boolean;
}

export interface DraftSummaryData {
  requestId: string;
  kind: CustomerKind;
  label: string;
  productCount: number;
  createdAt: string;
}

export interface BalanceData {
  /** Operations left in the package. Null when the plan sells no capacity. */
  capacityRemaining: number | null;
  walletAvailableHalalas: number;
}

/**
 * What a run that is not a plain success is charged, in the words the price row gives it.
 *
 * Written by the page from `chargedOutcomesSentenceAr`, never composed here: this screen is a
 * client component, so it cannot read a price row itself, and a second wording of the same
 * rule would be a second thing to keep true (ADR-170).
 */
export interface OutcomesData {
  /**
   * One sentence per product whose price row was read. A product with no price in force is
   * absent rather than carried at a default: a share nobody set is a share no screen prints.
   */
  perProductAr: Readonly<Record<string, string>>;
  /** What holds whatever the shares say, for when the ticked products do not agree on one. */
  anyAr: string;
}

export interface NewRequestView {
  kind: CustomerKind;
  products: ProductData[];
  showPrices: boolean;
  balance: BalanceData;
  /** Issued with the page. Every request made from it takes a key from here. */
  bundle: string;
  lookup: LookupData | null;
  draft: DraftData | null;
  drafts: DraftSummaryData[];
  /** Numbers a sandbox workspace can try. Empty in production. */
  samples: { number: string; titleAr: string; kind: CustomerKind }[];
  /** The shares in force, in words. Absent while the page has not read them. */
  outcomes?: OutcomesData | null | undefined;
  /** The sentences for a number, a certificate or an IBAN of the wrong shape. */
  problemsAr: Readonly<Record<'NUMBER' | 'REGISTRATION_UNKNOWN' | 'CERTIFICATE' | 'IBAN', string>>;
}

export type RequestField = 'number' | 'certificate' | 'iban';

/** What the screen sends to create a request or a draft. */
export interface RequestInput {
  kind: CustomerKind;
  number: string;
  certificateNumber: string;
  iban: string;
  entityId: string | null;
  productCodes: string[];
  bundle: string;
  /** The saved draft this was pressed on, if any. */
  draftId: string | null;
  /** «تحقق من الكل» on a draft submits it. One product's button leaves it saved. */
  mode: 'all' | 'one';
}

export type RequestResult =
  | { ok: true; request: RequestData; nextBundle: string }
  | { ok: false; errorAr: string; field: RequestField | null };

export type DraftResult =
  { ok: true; draftId: string } | { ok: false; errorAr: string; field: RequestField | null };

/** The server's side of the screen, handed in by the page. */
export interface NewRequestActions {
  lookup: (kind: CustomerKind, number: string) => Promise<LookupData>;
  standings: (kind: CustomerKind, entityId: string) => Promise<LookupData | null>;
  submit: (input: RequestInput) => Promise<RequestResult>;
  saveDraft: (input: RequestInput) => Promise<DraftResult>;
  status: (requestId: string) => Promise<RequestData | null>;
  discardDraft: (draftId: string) => Promise<boolean>;
}

/** The products in the order the screen lists them: what applies, then what is coming, then what does not apply. */
export function orderedProducts(
  products: readonly ProductData[],
  kind: CustomerKind,
): ProductData[] {
  const rank = (product: ProductData): number =>
    !product.appliesTo.includes(kind) ? 2 : product.availability !== 'AVAILABLE' ? 1 : 0;
  return products
    .map((product, index) => ({ product, index }))
    .sort((left, right) => rank(left.product) - rank(right.product) || left.index - right.index)
    .map((entry) => entry.product);
}

/** Can be ticked and run for this kind of customer. */
export function isOffered(product: ProductData, kind: CustomerKind): boolean {
  return (
    product.appliesTo.includes(kind) && product.availability === 'AVAILABLE' && product.allowed
  );
}

export function defaultSelection(products: readonly ProductData[], kind: CustomerKind): string[] {
  return products
    .filter((product) => isOffered(product, kind) && product.selectedByDefault)
    .map((product) => product.productCode);
}

/** A count of things in the form Arabic gives that number. */
function counted(
  n: number,
  forms: { one: string; two: string; few: (n: string) => string; many: (n: string) => string },
): string {
  if (n === 1) {
    return forms.one;
  }
  if (n === 2) {
    return forms.two;
  }
  return n >= 3 && n <= 10 ? forms.few(count(n)) : forms.many(count(n));
}

/** «6 منتجات متاحة لنوع الكيان المحدد». */
export function availableCountAr(n: number): string {
  if (n === 0) {
    return 'لا منتجات متاحة لنوع الكيان المحدد';
  }
  return `${counted(n, {
    one: 'منتج واحد متاح',
    two: 'منتجان متاحان',
    few: (value) => `${value} منتجات متاحة`,
    many: (value) => `${value} منتجاً متاحاً`,
  })} لنوع الكيان المحدد`;
}

/** «3 منتجات». */
export function productsCountAr(n: number): string {
  return counted(n, {
    one: 'منتج واحد',
    two: 'منتجان',
    few: (value) => `${value} منتجات`,
    many: (value) => `${value} منتجاً`,
  });
}

/** «تم اختيار 5 منتجات». */
export function selectedCountAr(n: number): string {
  if (n === 0) {
    return 'لم يُختر أي منتج';
  }
  return `تم اختيار ${counted(n, {
    one: 'منتج واحد',
    two: 'منتجين',
    few: (value) => `${value} منتجات`,
    many: (value) => `${value} منتجاً`,
  })}`;
}

/** «5 عمليات». */
function operationsCountAr(n: number): string {
  return counted(n, {
    one: 'عملية واحدة',
    two: 'عمليتان',
    few: (value) => `${value} عمليات`,
    many: (value) => `${value} عملية`,
  });
}

/**
 * What is left of the package and the bundles afterwards, as a floor rather than a figure.
 *
 * Every finished run counts one against the package's capacity whatever it answered, but a
 * bundle's operation is taken before the run and given back when the run costs nothing, so
 * what remains can only be this or more.
 */
function operationsLeftAr(n: number): string {
  if (n <= 0) {
    return 'لا تبقى عمليات في الباقة والحزم';
  }
  return `لا يقل ما يبقى عن ${operationsCountAr(n)}`;
}

/** «3.00 ر.س». */
export function priceAr(halalas: number): string {
  return `${riyals(halalas)} ر.س`;
}

/** How many calls a product makes for this customer: a manager check makes one per manager. */
export function operationsOf(product: ProductData, lookup: LookupData | null): number {
  return product.perManager ? Math.max(1, lookup?.managers ?? 0) : 1;
}

export interface Totals {
  products: number;
  operations: number;
  /**
   * What these operations are priced at in halalas, every one of them a full success and
   * whoever ends up paying for it. Not what the wallet can be charged: the figure below is.
   */
  totalHalalas: number;
  /** The most of that the wallet can be charged, once the package and the bundles have paid. */
  walletHalalas: number;
  /** The balance covers it: the package's operations first, then the wallet. */
  affordable: boolean;
  /** «الحدّ الأعلى 21.50 ر.س من رصيدك · لا يقل الرصيد بعدها عن 4,978.50 ر.س». */
  lineAr: string;
  /** What each result is charged, when the ticked products agree on it. */
  outcomesAr: string | null;
}

/**
 * The sentence for these products, or the half that holds for every price row.
 *
 * The same shape the customer file's verify dialog uses: one wording when the ticked products
 * share it, and otherwise what is true whatever the share is, with the screen that lists the
 * rest named. A share belonging to one product is never printed over a selection that does not
 * have it in common (ADR-170).
 */
function outcomesLineAr(selected: readonly ProductData[], outcomes: OutcomesData): string {
  const known = selected
    .map((product) => outcomes.perProductAr[product.productCode])
    .filter((sentence): sentence is string => sentence !== undefined);
  const first = known[0];
  const uniform =
    first !== undefined &&
    known.length === selected.length &&
    known.every((sentence) => sentence === first);
  return uniform ? first : outcomes.anyAr;
}

/**
 * What pressing «تحقق من الكل» can cost, as a ceiling and never as a promise.
 *
 * This line used to read «الإجمالي 21.50 ر.س · سيُخصم من الرصيد ويبقى 4,978.50 ر.س», and
 * both halves of that were wrong in the same direction. What is charged follows the result of
 * each step: an authority answering «لا يوجد» is charged the negative share, an answer served
 * from cache the cache share, and a technical failure and a skipped step nothing at all
 * (ADR-170). And while the package or a bundle pays, no riyals leave the wallet at all, so
 * naming a riyal total there named money that was never going to move.
 *
 * So the figure is the sum of the unit prices, which is exactly `maximumCharge` per run, the
 * amount held before a wallet run starts. It is said as the ceiling it is, the balance after
 * it as a floor, and the reason it is a ceiling is the sentence beside it.
 *
 * Which unit price, though, is the plan's to say and not this screen's. `quoteChecks` hands
 * each product both the price of one operation and the most that operation can be charged,
 * and a sum of several operations is built from the second: a plan reprices what it runs past
 * its committed capacity, and a selection that outruns the capacity is charged on both sides
 * of it (ADR-188).
 */
export function totalsOf(
  selected: readonly ProductData[],
  lookup: LookupData | null,
  balance: BalanceData,
  outcomes: OutcomesData | null = null,
): Totals {
  // Each operation twice over: what it is priced at, and the most it can be charged once the
  // package has stopped paying for it. The two differ by the plan's rate for an excess run.
  const operations = selected.flatMap((product) =>
    Array.from({ length: operationsOf(product, lookup) }, () => ({
      priceHalalas: product.unitPriceHalalas ?? 0,
      ceilingHalalas: product.ceilingUnitPriceHalalas ?? 0,
    })),
  );
  const totalHalalas = operations.reduce((sum, operation) => sum + operation.priceHalalas, 0);
  const capacity = balance.capacityRemaining ?? 0;
  const fromPackage = Math.min(capacity, operations.length);
  const walletOperations = operations.length - fromPackage;
  /**
   * What the wallet can be charged: the dearest of them, at the dearest they can go for.
   *
   * Two things were wrong with adding up the tail of the list at the listed price. The tail is
   * whichever operations happened to be drawn last, and which of the ticked ones the package
   * pays for is not this screen's to decide; and past the capacity the plan may charge its
   * overage rate rather than the included one, so operations that reach the wallet at all are
   * the ones whose price can rise. Both errors ran the same way, and it is the one direction a
   * figure printed beside a button may never run: the subscriber read a smaller number than
   * the run was about to hold (ADR-188).
   */
  const walletHalalas = operations
    .map((operation) => operation.ceilingHalalas)
    .sort((left, right) => right - left)
    .slice(0, walletOperations)
    .reduce((sum, price) => sum + price, 0);
  const affordable = operations.length > 0 && walletHalalas <= balance.walletAvailableHalalas;
  // A product whose price row was not found is carried at zero above, which is fine for a sum
  // that is only compared with the balance and a lie the moment it is printed as a ceiling.
  const priced = selected.every((product) => product.ceilingUnitPriceHalalas !== null);

  const parts: string[] = [];
  if (walletOperations === 0 && operations.length > 0) {
    parts.push('تُحتسب من الباقة والحزم لا من رصيدك', operationsLeftAr(capacity - fromPackage));
  } else if (operations.length > 0) {
    if (fromPackage > 0) {
      parts.push(`${operationsCountAr(fromPackage)} من الباقة والحزم`);
    }
    if (priced) {
      parts.push(
        `الحدّ الأعلى ${priceAr(walletHalalas)} من رصيدك`,
        `لا يقل الرصيد بعدها عن ${priceAr(Math.max(0, balance.walletAvailableHalalas - walletHalalas))}`,
      );
    } else {
      parts.push('لا سعر نافذ لبعض العمليات المختارة، فلا حدّ أعلى يُذكر');
    }
  }

  return {
    products: selected.length,
    operations: operations.length,
    totalHalalas,
    walletHalalas,
    affordable,
    lineAr: parts.length === 0 ? 'لا عمليات مختارة' : parts.join(' · '),
    // Nothing to say while the package pays: a share is a share of a riyal price, and this
    // run has none. The prices screen leaves the same column empty for the same reason.
    outcomesAr:
      outcomes === null || walletOperations === 0 || !priced
        ? null
        : outcomesLineAr(selected, outcomes),
  };
}

export interface RowView {
  /** Applies to this kind of customer. A row that does not is faded. */
  applicable: boolean;
  /** Can be ticked, and pressed. */
  enabled: boolean;
  running: boolean;
  tag: { tone: TagTone; text: string };
  buttonLabel: 'تحقق' | 'إعادة التحقق';
  /** The line under the name: the English name and what it brings, or why it cannot run. */
  lineAr: string;
  /** What the last attempt from this screen said, when it said something. */
  noteAr: string | null;
}

/** What a check that ran from this screen ended in, kept until the page is left. */
export interface SessionResult {
  outcome: RequestOutcome | null;
  status: RequestCheckStatus;
  noteAr: string | null;
}

function standingTag(standing: StandingData | undefined): { tone: TagTone; text: string } {
  switch (standing?.state) {
    case 'VERIFIED':
      return {
        tone: 'accent-2',
        text:
          standing.verifiedAt === null
            ? 'مُتحقق سابقاً'
            : `مُتحقق سابقاً · ${dayMonthAr(new Date(standing.verifiedAt))}`,
      };
    case 'CONFLICT':
      return { tone: 'accent', text: standing.issueAr ?? 'تعارض' };
    case 'CHANGED':
      return { tone: 'accent', text: 'تغيّر مرصود' };
    case 'EXPIRED':
      return { tone: 'neutral', text: 'منتهي' };
    case 'PARTIAL':
      return {
        tone: 'neutral',
        text: standing.issueAr === null ? 'جزئي' : `جزئي · ${standing.issueAr}`,
      };
    case 'NOT_FOUND':
      return { tone: 'neutral', text: 'غير موجود' };
    case 'FAILED':
      return { tone: 'neutral', text: 'فشل' };
    case 'RUNNING':
      return { tone: 'neutral', text: 'قيد المعالجة' };
    default:
      return { tone: 'neutral', text: 'لم يُتحقق' };
  }
}

function resultTag(
  result: SessionResult,
  standing: StandingData | undefined,
): { tone: TagTone; text: string } {
  if (result.status === 'SKIPPED') {
    return { tone: 'neutral', text: 'لم يُنفّذ' };
  }
  if (result.status === 'FAILED') {
    return { tone: 'neutral', text: 'فشل' };
  }
  if (result.outcome === 'NOT_FOUND') {
    return { tone: 'neutral', text: 'غير موجود' };
  }
  if (result.outcome === 'AWAITING') {
    return { tone: 'neutral', text: 'بانتظار الجهة الرسمية' };
  }
  // It came back verified. What the file now says about it wins: a name that does not match
  // is the thing to see, not that the call succeeded.
  if (standing && ['CONFLICT', 'CHANGED', 'PARTIAL'].includes(standing.state)) {
    return standingTag(standing);
  }
  return { tone: 'accent-2', text: 'مُتحقق' };
}

export function rowView(
  product: ProductData,
  context: {
    kind: CustomerKind;
    standing: StandingData | undefined;
    /** The check is queued or running in a request from this screen. */
    live: RequestCheckData | undefined;
    result: SessionResult | undefined;
  },
): RowView {
  const summary =
    product.summaryAr === null ? product.nameEn : `${product.nameEn} · ${product.summaryAr}`;
  const base = {
    running: false,
    buttonLabel:
      context.standing?.hasResult || context.result ? ('إعادة التحقق' as const) : ('تحقق' as const),
    lineAr: summary,
    noteAr: null,
  };

  if (!product.appliesTo.includes(context.kind)) {
    return {
      ...base,
      applicable: false,
      enabled: false,
      buttonLabel: 'تحقق',
      tag: { tone: 'neutral', text: 'غير مطبّق' },
      lineAr: `${product.nameEn} · غير متاح لنوع الكيان «${kindLabel(context.kind)}»`,
    };
  }
  if (product.availability !== 'AVAILABLE') {
    return {
      ...base,
      applicable: true,
      enabled: false,
      buttonLabel: 'تحقق',
      tag: { tone: 'neutral', text: 'قريباً' },
    };
  }
  if (!product.allowed) {
    return {
      ...base,
      applicable: true,
      enabled: false,
      buttonLabel: 'تحقق',
      tag: { tone: 'neutral', text: product.refusalAr ?? 'غير متاح' },
    };
  }

  const running =
    context.live !== undefined
      ? context.live.status === 'QUEUED' || context.live.status === 'RUNNING'
      : context.standing?.state === 'RUNNING';
  if (running) {
    return {
      ...base,
      applicable: true,
      enabled: false,
      running: true,
      tag: { tone: 'neutral', text: 'قيد المعالجة' },
    };
  }

  if (context.result) {
    return {
      ...base,
      applicable: true,
      enabled: true,
      tag: resultTag(context.result, context.standing),
      noteAr:
        context.result.status === 'DONE' && context.result.outcome !== 'NOT_FOUND'
          ? null
          : context.result.noteAr,
    };
  }
  return { ...base, applicable: true, enabled: true, tag: standingTag(context.standing) };
}

/** The sentence beside the number: who was found, or what to do next. */
export function lookupLineAr(
  lookup: LookupData | null,
  state: {
    searching: boolean;
    /** A problem with the number found when the request was pressed. */
    problemAr: string | null;
    draft: DraftData | null;
    problemsAr: NewRequestView['problemsAr'];
  },
): { textAr: string | null; problem: boolean } {
  if (state.problemAr !== null) {
    return { textAr: state.problemAr, problem: true };
  }
  if (state.draft !== null) {
    const saved = `مسودة محفوظة في ${dayMonthAr(new Date(state.draft.createdAt))}`;
    return {
      textAr: lookup?.displayName ? `${saved} لـ«${lookup.displayName}».` : `${saved}.`,
      problem: false,
    };
  }
  // What the last number turned out to be is stale the moment another is typed.
  if (state.searching) {
    return { textAr: 'جارٍ البحث عن ملف العميل…', problem: false };
  }
  switch (lookup?.status) {
    case 'INVALID':
      return { textAr: state.problemsAr.NUMBER, problem: true };
    case 'REGISTRATION_UNKNOWN':
      return { textAr: state.problemsAr.REGISTRATION_UNKNOWN, problem: true };
    case 'FOUND': {
      // «بملفها» for a company or an establishment, «بملفه» for a freelancer.
      const file = lookup.kind === 'FREELANCER' ? 'بملفه' : 'بملفها';
      return {
        textAr: lookup.displayName
          ? `تم العثور على «${lookup.displayName}»، سيُربط التحقق ${file} الحالي.`
          : 'تم العثور على ملف العميل، سيُربط التحقق به.',
        problem: false,
      };
    }
    case 'NEW':
      return { textAr: 'لا يوجد ملف بهذا الرقم، سيُنشأ ملف جديد عند التحقق.', problem: false };
    default:
      return { textAr: null, problem: false };
  }
}
