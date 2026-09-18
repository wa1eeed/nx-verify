import type { UserRole } from '@nx-verify/core';

/**
 * What each role in a workspace is called, and what it may do.
 *
 * Here rather than beside the screen that lists people, because the form that adds one runs in
 * the browser and the list runs on the server: a file both can import must carry nothing but
 * words and a type.
 *
 * These are presets for the jobs in a subscriber's company, not tiers of seniority, and the
 * hints say what somebody in that job can actually reach. The exact permissions each one
 * carries are in packages/core/src/auth/capabilities.ts, and the screen shows them.
 */

export const ROLE_LABELS: Record<UserRole, string> = {
  VIEWER: 'مطّلع',
  ANALYST: 'موظف تحقق',
  APPROVER: 'معتمِد',
  FINANCE: 'المالية',
  COMPLIANCE: 'إدارة الالتزام',
  ADMIN: 'مسؤول الحساب',
};

export const ROLE_HINTS: Record<UserRole, string> = {
  VIEWER: 'يقرأ ملفات العملاء والرصيد، ولا يغيّر شيئاً ولا يصرف',
  ANALYST: 'يشغّل التحقق ويبتّ في حالات المراجعة ويدير المراقبة',
  APPROVER: 'كل ما يفعله موظف التحقق، ويعتمد ما بتّ فيه غيره',
  FINANCE: 'الرصيد والفواتير وطلبات الشحن والأسعار. لا يرى ملفات العملاء',
  COMPLIANCE: 'يبتّ ويعتمد ويضبط قواعد القرار ويقرأ سجل التدقيق. لا يصرف من الرصيد',
  ADMIN: 'كل ما سبق، ويدير المستخدمين والصلاحيات والمفاتيح والإعدادات',
};

/**
 * The order the roles are offered in: what a subscriber hands out most often, first.
 *
 * Not the order of the type, which is historical, and not alphabetical, which means nothing
 * to the person choosing.
 */
export const ROLE_ORDER: readonly UserRole[] = [
  'ANALYST',
  'COMPLIANCE',
  'FINANCE',
  'APPROVER',
  'VIEWER',
  'ADMIN',
];
