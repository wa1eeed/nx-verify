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
  identifierMasked: string | null;
  kind: CustomerKind | null;
  accountMasked: string | null;
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
  subjectMasked: string | null;
  productCodes: string[];
  createdAt: string;
  ibanMasked: string | null;
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

function operationsLeftAr(n: number): string {
  if (n <= 0) {
    return 'ولا تبقى عمليات في الباقة';
  }
  return `ويبقى ${counted(n, {
    one: 'عملية واحدة',
    two: 'عمليتان',
    few: (value) => `${value} عمليات`,
    many: (value) => `${value} عملية`,
  })}`;
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
  totalHalalas: number;
  /** The balance covers it: the package's operations first, then the wallet. */
  affordable: boolean;
  /** «الإجمالي 16.00 ر.س · سيُخصم من الرصيد ويبقى 1,835 عملية». */
  lineAr: string;
}

export function totalsOf(
  selected: readonly ProductData[],
  lookup: LookupData | null,
  balance: BalanceData,
): Totals {
  // Each operation at its price, in the order they run, so the package pays for the first.
  const operations = selected.flatMap((product) =>
    Array.from({ length: operationsOf(product, lookup) }, () => product.unitPriceHalalas ?? 0),
  );
  const totalHalalas = operations.reduce((sum, price) => sum + price, 0);
  const capacity = balance.capacityRemaining ?? 0;
  const fromPackage = Math.min(capacity, operations.length);
  const fromWallet = operations.slice(fromPackage).reduce((sum, price) => sum + price, 0);
  const affordable = operations.length > 0 && fromWallet <= balance.walletAvailableHalalas;

  const total = `الإجمالي ${priceAr(totalHalalas)}`;
  const lineAr =
    capacity > 0 && fromWallet === 0
      ? `${total} · سيُخصم من الرصيد ${operationsLeftAr(capacity - fromPackage)}`
      : `${total} · سيُخصم من الرصيد ويبقى ${priceAr(Math.max(0, balance.walletAvailableHalalas - fromWallet))}`;

  return {
    products: selected.length,
    operations: operations.length,
    totalHalalas,
    affordable,
    lineAr,
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
