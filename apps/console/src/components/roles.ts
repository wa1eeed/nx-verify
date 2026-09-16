import type { UserRole } from '@nx-verify/core';

/**
 * What each role in a workspace is called, and what it may do.
 *
 * Here rather than beside the screen that lists people, because the form that adds one runs in
 * the browser and the list runs on the server: a file both can import must carry nothing but
 * words and a type.
 */

export const ROLE_LABELS: Record<UserRole, string> = {
  VIEWER: 'مطّلع',
  ANALYST: 'محلل',
  APPROVER: 'معتمِد',
  ADMIN: 'مسؤول',
};

export const ROLE_HINTS: Record<UserRole, string> = {
  VIEWER: 'يقرأ الملفات ولا يغيّر شيئاً',
  ANALYST: 'يشغّل التحقق ويبتّ في حالات المراجعة',
  APPROVER: 'يعتمد ما بتّ فيه المحلل',
  ADMIN: 'كل ما سبق، ويدير المستخدمين والمفاتيح والإعدادات',
};
