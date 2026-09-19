import type { WebhookEventType } from '@nx-verify/core';

/**
 * What each event is called, and how serious it is.
 *
 * Here rather than in the domain, for the same reason the role labels are: the forms that show
 * these run in the browser, and importing `@nx-verify/core` from a client component drags the
 * whole server side in behind it, `pg` included. A file both sides can import carries nothing
 * but words and a type.
 *
 * The type import is erased at compile time, so it costs nothing and still fails the build if
 * an event is added to the union and not named here.
 */

export const EVENT_LABELS_AR: Readonly<Record<WebhookEventType, string>> = {
  'verification.completed': 'اكتمال تحقق',
  'verification.awaiting': 'تحقق بانتظار رد الجهة',
  'entity.changed': 'تغيّر مرصود',
  'attestation.expired': 'انتهاء صلاحية معرفة',
  'wallet.low': 'انخفاض رصيد الخدمات',
  'monitor.budget_exhausted': 'توقف مراقبة لانتهاء ميزانيتها',
  'onboarding.approved': 'اعتماد ملف تأهيل',
  'onboarding.rejected': 'رفض ملف تأهيل',
  'onboarding.review': 'ملف تأهيل يحتاج مراجعة بشرية',
};

/** The severity each event always carries, so a screen states the fact rather than asking. */
export const EVENT_SEVERITY: Readonly<Record<WebhookEventType, 'INFO' | 'WARNING' | 'CRITICAL'>> = {
  'verification.completed': 'INFO',
  'verification.awaiting': 'INFO',
  'entity.changed': 'WARNING',
  'attestation.expired': 'WARNING',
  'wallet.low': 'CRITICAL',
  'monitor.budget_exhausted': 'WARNING',
  'onboarding.approved': 'INFO',
  'onboarding.rejected': 'WARNING',
  'onboarding.review': 'WARNING',
};

export const SEVERITY_LABELS_AR: Readonly<Record<'INFO' | 'WARNING' | 'CRITICAL', string>> = {
  INFO: 'للعلم',
  WARNING: 'يستحق النظر',
  CRITICAL: 'حرج',
};

/** The list a screen offers, in the order somebody reads it: the common ones first. */
export const EVENT_TYPES: readonly WebhookEventType[] = [
  'verification.completed',
  'verification.awaiting',
  'entity.changed',
  'attestation.expired',
  'onboarding.review',
  'onboarding.approved',
  'onboarding.rejected',
  'wallet.low',
  'monitor.budget_exhausted',
];

export function eventLabelAr(eventType: string): string {
  return (EVENT_LABELS_AR as Record<string, string>)[eventType] ?? eventType;
}
