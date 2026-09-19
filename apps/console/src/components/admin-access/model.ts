import {
  OPERATOR_ROLE_LABELS,
  type OperatorAuditRow,
  type OperatorRole,
  type ProfileSection,
} from '@nx-verify/core';
import { riyals } from '../format';
import { SECTION_TAGS, monthsAr } from '../admin-pricing/model';

/**
 * The audit trail of the administration panel, in words (handoff screen 00, «الصلاحيات
 * والتدقيق»).
 *
 * A row holds a code for what was done, a reference to what it was done to, and the field
 * names and figures that changed. The screen says each in Arabic: the product, bundle, plan,
 * subscriber or member of staff by name, and the connection to the data source by its
 * environment, never by the name of the source (rule 5).
 */

/**
 * A tax period is a pricing decision and a route is part of the connection, so each belongs
 * under the tab a reader would look in. Left out, they were reachable only from «الكل», which
 * made «show me every price change» quietly incomplete.
 */
export const AUDIT_SCOPES = [
  { key: 'all', label: 'الكل', actions: [] },
  { key: 'pricing', label: 'الأسعار', actions: ['pricing.', 'vat.'] },
  { key: 'settings', label: 'إعدادات التحقق', actions: ['settings.', 'risk.'] },
  {
    key: 'integration',
    label: 'الربط',
    actions: ['connection.', 'credentials.', 'routing.', 'callback.'],
  },
  { key: 'staff', label: 'الفريق', actions: ['staff.'] },
] as const satisfies readonly { key: string; label: string; actions: readonly string[] }[];

export type AuditScope = (typeof AUDIT_SCOPES)[number]['key'];

export function auditScopeOf(raw: string | undefined): AuditScope {
  return AUDIT_SCOPES.some((scope) => scope.key === raw) ? (raw as AuditScope) : 'all';
}

/**
 * Every action written into `operator_audit`, said in Arabic.
 *
 * An action missing from here is not hidden, it is printed as its own English code at a reader
 * of an Arabic screen: «vat.period_set» in the column that is supposed to say what happened.
 * Anything that writes a row belongs in this map on the same commit.
 */
const ACTIONS: Readonly<Record<string, string>> = {
  'connection.set': 'ضبط الربط مع مصدر البيانات',
  'connection.tested': 'اختبار الاتصال',
  'credentials.saved': 'حفظ بيانات الربط',
  'callback.updated': 'تعديل عنوان استقبال الإشعارات',
  'callback.rotated': 'تجديد سر توقيع الإشعارات',
  'routing.set': 'توجيه خدمة إلى مصدر',
  'routing.removed': 'رفع مصدر عن خدمة',
  'routing.binding_set': 'ضبط اعتماد مشترك مع مصدر',
  'mail.settings_set': 'ضبط البريد الصادر',
  'staff.first_owner': 'إنشاء أول مالك',
  'staff.created': 'إضافة عضو إلى الفريق',
  'staff.updated': 'تعديل دور أو حالة',
  'staff.password_set': 'تعيين كلمة مرور',
  'staff.second_factor_enrolled': 'تفعيل المصادقة الثنائية',
  'staff.second_factor_reset': 'إعادة تعيين المصادقة الثنائية',
  'staff.recovery_code_used': 'دخول برمز استرداد',
  'pricing.list_price': 'تعديل سعر منتج',
  'pricing.price_cleared': 'إلغاء سعر منتج',
  'pricing.product_suspended': 'إيقاف بيع منتج',
  'pricing.product_resumed': 'إعادة بيع منتج',
  // Kept for rows written before adding and replacing were told apart.
  'pricing.bundle_saved': 'حفظ حزمة رصيد',
  'pricing.bundle_added': 'إضافة حزمة رصيد',
  'pricing.bundle_replaced': 'استبدال حزمة رصيد',
  'pricing.bundle_retired': 'إيقاف بيع حزمة',
  'pricing.plan_added': 'إضافة باقة',
  'pricing.plan_terms': 'تعديل شروط باقة',
  'pricing.plan_product': 'تعديل منتج داخل باقة',
  'pricing.tenant_exception': 'استثناء لمشترك',
  'pricing.special_price': 'سعر خاص لمشترك',
  'pricing.discount': 'خصم لمشترك',
  'pricing.provider_cost': 'تعديل تكلفة نداء',
  'pricing.module_default': 'تعديل افتراضي وحدة تحقق',
  'vat.period_set': 'ضبط فترة ضريبة القيمة المضافة',
  'settings.updated': 'تعديل إعدادات التحقق',
  'settings.section': 'تعديل الأقسام المطلوبة',
  'risk.signal_set': 'تعديل مؤشر خطر',
  'risk.product_set': 'تشغيل أو إيقاف الخطر لخدمة',
  'risk.category_set': 'تشغيل أو إيقاف نوع من الخطر',
  'risk.bands_set': 'تعديل حدود الخطر',
  'subscribers.created': 'إضافة مشترك',
  'subscribers.plan': 'تغيير باقة مشترك',
  'subscribers.suspended': 'إيقاف مشترك',
  'subscribers.resumed': 'إعادة تفعيل مشترك',
  'subscribers.sandbox_created': 'إنشاء مساحة اختبار لمشترك',
  'subscribers.sandbox_refused': 'إغلاق طلب مساحة اختبار',
};

export function auditActionAr(action: string): string {
  return ACTIONS[action] ?? action;
}

export const ROLE_DESCRIPTIONS: Readonly<Record<OperatorRole, string>> = {
  OWNER: 'كل شيء، ومنه إضافة الفريق وأدوارهم',
  PRICING: 'الأسعار والحزم والباقات وإعدادات التحقق',
  SUPPORT: 'المشتركون وأرصدتهم والحوالات',
  READ_ONLY: 'يطّلع ولا يغيّر شيئاً',
};

export interface AuditNames {
  products: ReadonlyMap<string, string>;
  plans: ReadonlyMap<string, string>;
  tenants: ReadonlyMap<string, string>;
  staff: ReadonlyMap<string, string>;
}

const SETTING_NAMES: Readonly<Record<string, string>> = {
  maxAttempts: 'عدد المحاولات',
  resultValidityDays: 'مدة الصلاحية',
  nameMatchThresholdPct: 'حد تطابق الاسم',
  registryAlertDays: 'تنبيه انتهاء السجل',
};

const KIND_NAMES: Readonly<Record<string, string>> = {
  COMPANY: 'شركة',
  ESTABLISHMENT: 'مؤسسة',
  FREELANCER: 'عامل حر',
};

const ENVIRONMENTS: Readonly<Record<string, string>> = {
  sandbox: 'بيئة الاختبار',
  live: 'بيئة الإنتاج',
};

/** What a change was made to, by name. */
export function auditTargetAr(target: string, names: AuditNames): string {
  const [scope, kind, id = ''] = target.split(':');
  if (scope === 'pricing' && kind === 'product') {
    return names.products.get(id) ?? id;
  }
  // A route is written `routing:<service>`, and the source it was routed to is deliberately
  // not in the target: the panel names the service, never the source (rule 5).
  if (scope === 'routing') {
    return names.products.get(kind ?? '') ?? kind ?? '·';
  }
  if (scope === 'vat') {
    return kind === undefined ? 'ضريبة القيمة المضافة' : `ضريبة القيمة المضافة من ${kind}`;
  }
  // `cost:<source>:<endpoint>` carries the source's own name, which is why only the fact that
  // a call has a cost is said here.
  if (scope === 'cost') {
    return 'تكلفة نداء';
  }
  if (scope === 'risk') {
    if (kind === 'bands') {
      return 'حدود الخطر';
    }
    return kind === 'product' ? (names.products.get(id) ?? id) : 'مؤشرات الخطر';
  }
  if (scope === 'subscriber') {
    return names.tenants.get(kind ?? '') ?? 'مشترك';
  }
  if (scope === 'mail') {
    return 'البريد الصادر';
  }
  if (scope === 'pricing' && kind === 'bundle') {
    const operations = Number(id.replace(/^BUNDLE_/, ''));
    return Number.isInteger(operations) ? `حزمة ${operations} عملية` : id;
  }
  if (scope === 'pricing' && kind === 'plan') {
    return names.plans.get(id) ?? id;
  }
  // A module by its code: the panel holds no map of module names, and the code is what every
  // other screen prints beside one.
  if (scope === 'pricing' && kind === 'module') {
    return id;
  }
  if (scope === 'pricing' && kind === 'tenant') {
    return names.tenants.get(id) ?? 'مشترك';
  }
  if (scope === 'settings') {
    return kind === 'sections' ? 'الأقسام المطلوبة' : 'إعدادات التحقق';
  }
  if (scope === 'staff') {
    return names.staff.get(kind ?? '') ?? 'عضو في الفريق';
  }
  // The connection to the data source is written `<source>/<environment>`. Only the
  // environment is said.
  const environment = target.split('/')[1];
  if (environment !== undefined && ENVIRONMENTS[environment] !== undefined) {
    return `الربط · ${ENVIRONMENTS[environment]}`;
  }
  return '·';
}

function money(value: unknown): string | null {
  return typeof value === 'number' ? riyals(value) : null;
}

/** Only what moved, because the plan terms are written as a change and not as a state. */
function planTermsAr(meta: Readonly<Record<string, unknown>>): string {
  const parts: string[] = [];
  if (typeof meta['fee'] === 'number') {
    parts.push(`الرسم ${riyals(meta['fee'])} ر.س`);
  }
  if ('operations' in meta) {
    parts.push(
      meta['operations'] === null ? 'حد مخصص' : `${String(meta['operations'])} عملية مشمولة`,
    );
  }
  if ('overage' in meta) {
    parts.push(
      typeof meta['overage'] === 'number'
        ? `تجاوز ${riyals(meta['overage'])} ر.س`
        : 'بلا سعر تجاوز',
    );
  }
  if (typeof meta['term_months'] === 'number') {
    parts.push(`التزام ${monthsAr(meta['term_months'])}`);
  }
  if (typeof meta['free_reverify_days'] === 'number') {
    parts.push(`إعادة التحقق المجانية ${meta['free_reverify_days']} يوماً`);
  }
  if (typeof meta['setup_fee'] === 'number') {
    parts.push(`رسم التأسيس ${riyals(meta['setup_fee'])} ر.س`);
  }
  if (typeof meta['commitment_credits'] === 'number') {
    parts.push(`رصيد التوقيع ${riyals(meta['commitment_credits'])} ر.س`);
  }
  if (typeof meta['overage_allowed'] === 'boolean') {
    parts.push(meta['overage_allowed'] ? 'يستمر العمل بعد الحد' : 'يتوقف العمل عند الحد');
  }
  return parts.length === 0 ? 'بلا تغيير' : parts.join('، ');
}

/** What changed, in a line: figures from and to, never a value that is material. */
export function auditChangeAr(row: Pick<OperatorAuditRow, 'action' | 'metadata'>): string {
  const meta = row.metadata;
  switch (row.action) {
    case 'pricing.list_price': {
      const from = money(meta['from']);
      const to = money(meta['to']);
      const margin = typeof meta['margin_pct'] === 'number' ? ` · هامش ${meta['margin_pct']}%` : '';
      const price = from === null ? `${to ?? '·'}${margin}` : `من ${from} إلى ${to ?? '·'}${margin}`;
      // Written only when they moved, and they decide what a not found or a cached answer is
      // charged, so a change to one of them is a change to the bill.
      const rates = [
        ['غير موجود', meta['negative_pct']],
        ['نتيجة مخزّنة', meta['cache_pct']],
      ]
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
        .map(([label, fraction]) => `${label} ${Math.round(fraction * 100)}%`);
      return rates.length === 0 ? price : `${price} · ${rates.join(' · ')}`;
    }
    case 'pricing.bundle_saved':
    case 'pricing.bundle_added':
    case 'pricing.bundle_replaced': {
      const parts = [
        `${money(meta['price']) ?? '·'} ر.س`,
        typeof meta['months'] === 'number' ? monthsAr(meta['months']) : '·',
      ];
      if (typeof meta['from'] === 'number') {
        parts.unshift(`من ${money(meta['from']) ?? '·'} ر.س`);
      }
      if (meta['resumed'] === true) {
        parts.push('وأُعيدت للبيع');
      }
      return parts.join(' · ');
    }
    case 'pricing.plan_added':
      return `${money(meta['fee']) ?? '·'} ر.س شهرياً · ${String(meta['operations'] ?? '·')} عملية`;
    case 'pricing.plan_terms':
      return planTermsAr(meta);
    case 'pricing.plan_product':
    case 'pricing.tenant_exception': {
      const parts = [String(meta['product'] ?? '·')];
      if (typeof meta['enabled'] === 'boolean') {
        parts.push(meta['enabled'] ? 'مفعّل' : 'موقوف');
      }
      if ('monthly_quota' in meta) {
        parts.push(
          meta['monthly_quota'] === null
            ? 'بلا حد شهري'
            : `حد شهري ${String(meta['monthly_quota'])}`,
        );
      }
      if ('price' in meta) {
        parts.push(meta['price'] === null ? 'بلا سعر خاص' : `${money(meta['price']) ?? '·'} ر.س`);
      }
      return parts.join(' · ');
    }
    case 'pricing.special_price':
      return meta['price'] === null
        ? 'إلغاء السعر الخاص'
        : `${String(meta['product'] ?? '')} ${money(meta['price']) ?? ''}`.trim();
    case 'pricing.discount':
      return meta['discount_pct'] === null ? 'إلغاء الخصم' : `خصم ${String(meta['discount_pct'])}%`;
    case 'pricing.module_default': {
      // The count is written with the change because it is not recoverable afterwards: the
      // cascade keeps no memory of who was moved, so the row is the only place it survives.
      const moved =
        typeof meta['affected'] === 'number' ? ` · مسّت ${meta['affected']} من المشتركين` : '';
      return `${meta['default_on'] === true ? 'تُمنح افتراضياً' : 'لا تُمنح إلا بقرار'}${moved}`;
    }
    case 'subscribers.created':
    case 'subscribers.plan': {
      // A move between two plans, said as a move. The destination alone reads as a fact about
      // today and answers nothing about what changed, which is the only reason the row exists.
      const to = typeof meta['package'] === 'string' ? meta['package'] : null;
      const from = typeof meta['from'] === 'string' ? meta['from'] : null;
      if (to === null) {
        return '·';
      }
      return from === null || from === to ? to : `من ${from} إلى ${to}`;
    }
    case 'settings.updated':
      return Object.entries(meta)
        .map(([key, value]) => {
          const change = value as { from?: unknown; to?: unknown };
          return `${SETTING_NAMES[key] ?? key}: من ${String(change.from)} إلى ${String(change.to)}`;
        })
        .join('، ');
    case 'settings.section': {
      const section = SECTION_TAGS[meta['section'] as ProfileSection]?.name ?? '';
      const requirement = meta['requirement'] === 'REQUIRED' ? 'مطلوب' : 'اختياري';
      return [KIND_NAMES[String(meta['kind'])], section, requirement].filter(Boolean).join(' · ');
    }
    case 'staff.recovery_code_used':
      return typeof meta['remaining'] === 'number'
        ? `بقي ${meta['remaining']} من رموز الاسترداد`
        : '·';
    case 'staff.created':
    case 'staff.first_owner':
    case 'staff.updated': {
      const parts: string[] = [];
      if (typeof meta['role'] === 'string') {
        parts.push(`الدور: ${OPERATOR_ROLE_LABELS[meta['role'] as OperatorRole] ?? meta['role']}`);
      }
      if (typeof meta['status'] === 'string') {
        parts.push(meta['status'] === 'ACTIVE' ? 'مفعّل' : 'موقوف');
      }
      return parts.join(' · ') || '·';
    }
    default: {
      const fields = Array.isArray(meta['fields'])
        ? (meta['fields'] as string[])
        : Object.keys(meta);
      return fields.length === 0 ? '·' : fields.join('، ');
    }
  }
}
