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

export const AUDIT_SCOPES = [
  { key: 'all', label: 'الكل', actions: [] },
  { key: 'pricing', label: 'الأسعار', actions: ['pricing.'] },
  { key: 'settings', label: 'إعدادات التحقق', actions: ['settings.'] },
  { key: 'integration', label: 'الربط', actions: ['connection.', 'credentials.'] },
  { key: 'staff', label: 'الفريق', actions: ['staff.'] },
] as const satisfies readonly { key: string; label: string; actions: readonly string[] }[];

export type AuditScope = (typeof AUDIT_SCOPES)[number]['key'];

export function auditScopeOf(raw: string | undefined): AuditScope {
  return AUDIT_SCOPES.some((scope) => scope.key === raw) ? (raw as AuditScope) : 'all';
}

const ACTIONS: Readonly<Record<string, string>> = {
  'connection.set': 'ضبط الربط مع مصدر البيانات',
  'connection.tested': 'اختبار الاتصال',
  'credentials.saved': 'حفظ بيانات الربط',
  'staff.first_owner': 'إنشاء أول مالك',
  'staff.created': 'إضافة عضو إلى الفريق',
  'staff.updated': 'تعديل دور أو حالة',
  'staff.password_set': 'تعيين كلمة مرور',
  'pricing.list_price': 'تعديل سعر منتج',
  'pricing.product_suspended': 'إيقاف بيع منتج',
  'pricing.product_resumed': 'إعادة بيع منتج',
  'pricing.bundle_saved': 'حفظ حزمة رصيد',
  'pricing.bundle_retired': 'إيقاف بيع حزمة',
  'pricing.plan_added': 'إضافة باقة',
  'pricing.special_price': 'سعر خاص لمشترك',
  'pricing.discount': 'خصم لمشترك',
  'settings.updated': 'تعديل إعدادات التحقق',
  'settings.section': 'تعديل الأقسام المطلوبة',
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
  if (scope === 'pricing' && kind === 'bundle') {
    const operations = Number(id.replace(/^BUNDLE_/, ''));
    return Number.isInteger(operations) ? `حزمة ${operations} عملية` : id;
  }
  if (scope === 'pricing' && kind === 'plan') {
    return names.plans.get(id) ?? id;
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

/** What changed, in a line: figures from and to, never a value that is material. */
export function auditChangeAr(row: Pick<OperatorAuditRow, 'action' | 'metadata'>): string {
  const meta = row.metadata;
  switch (row.action) {
    case 'pricing.list_price': {
      const from = money(meta['from']);
      const to = money(meta['to']);
      const margin = typeof meta['margin_pct'] === 'number' ? ` · هامش ${meta['margin_pct']}%` : '';
      return from === null ? `${to ?? '·'}${margin}` : `من ${from} إلى ${to ?? '·'}${margin}`;
    }
    case 'pricing.bundle_saved':
      return `${money(meta['price']) ?? '·'} ر.س · ${
        typeof meta['months'] === 'number' ? monthsAr(meta['months']) : '·'
      }`;
    case 'pricing.plan_added':
      return `${money(meta['fee']) ?? '·'} ر.س شهرياً · ${String(meta['operations'] ?? '·')} عملية`;
    case 'pricing.special_price':
      return meta['price'] === null
        ? 'إلغاء السعر الخاص'
        : `${String(meta['product'] ?? '')} ${money(meta['price']) ?? ''}`.trim();
    case 'pricing.discount':
      return meta['discount_pct'] === null ? 'إلغاء الخصم' : `خصم ${String(meta['discount_pct'])}%`;
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
