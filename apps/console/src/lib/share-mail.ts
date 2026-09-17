import { FIELD_GROUP_LABELS, type FieldGroup } from '@nx-verify/core';
import { dateAr } from '../components/format';

/**
 * The message that carries a shared profile to somebody outside the workspace (ADR-144).
 *
 * Worked out apart from the action so the wording is tested once and cannot drift: what the
 * recipient is told they are opening, when it stops working, and who opened it for them.
 *
 * Two rules the body keeps. It names no identifier: the profile behind the link masks every
 * one of them, and a mail is the least private place in this platform. And it says the date
 * the link dies, because a link whose end is a surprise is a link somebody keeps forwarding.
 */

/**
 * An address as a person types one.
 *
 * Deliberately not a specification-complete grammar. This is the difference between a typed
 * address and a typo, not a proof of deliverability, and the service that sends it has the
 * last word anyway.
 */
export function isAddress(raw: string): boolean {
  const value = raw.trim();
  return value.length <= 254 && /^[^\s@,;:<>"]+@[^\s@.,;:<>"]+(\.[^\s@.,;:<>"]+)+$/.test(value);
}

export interface ShareMailInput {
  /** Whose file it is, as the subscriber's own screen names them. */
  customerName: string;
  /** The workspace doing the sharing, so the recipient knows who to ask about it. */
  senderName: string;
  groups: readonly FieldGroup[];
  link: string;
  expiresAt: Date;
  /** What the subscriber wrote the share was for. Shown only when there is one. */
  purpose: string | null;
}

export interface ComposedMail {
  subject: string;
  body: string;
}

/** «ملف <العميل> · مشاركة من <المشترك>», and the body underneath it. */
export function shareMail(input: ShareMailInput): ComposedMail {
  const opened = input.groups.map((group) => FIELD_GROUP_LABELS[group]).join('، ');
  const lines = [
    `شارك معك ${input.senderName} ملف ${input.customerName} المتحقق منه عبر NX Trust.`,
    '',
    `ما يفتحه الرابط: ${opened}.`,
    ...(input.purpose === null ? [] : [`الغرض: ${input.purpose}.`]),
    `ينتهي الرابط في ${dateAr(input.expiresAt)}، وبعدها لا يفتح شيئاً.`,
    '',
    input.link,
    '',
    'المعرّفات في الملف مقنّعة، وكل حقل فيه يحمل جهته وتاريخ رصده.',
    `إن وصلتك هذه الرسالة بالخطأ فاحذفها، وأبلغ ${input.senderName}.`,
  ];
  return {
    subject: `ملف ${input.customerName} · مشاركة من ${input.senderName}`,
    body: lines.join('\n'),
  };
}
