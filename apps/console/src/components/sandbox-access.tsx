'use client';

import { useActionState, type ReactElement } from 'react';
import { Card, CardEmpty, CardNote, CardTitle } from './ui/card';
import { Disclosure } from './ui/disclosure';
import { Ltr } from './ui/ltr';
import { Notice } from './ui/notice';
import { StatHint, StatLabel, StatValue } from './ui/stat';
import { SubmitButton } from './ui/submit-button';
import { Table, Th } from './ui/table';
import { Tag, type TagTone } from './ui/tag';
import { isoDate } from './format';

/**
 * Asking for a sandbox, and answering the ask (ADR-173).
 *
 * The subscriber's half of this screen used to be a link to the support page, which is not a
 * path to a sandbox, it is a path to a form about one. The reason it was only a link is real
 * and is said on the card rather than hidden: a workspace cannot link itself to another one,
 * because a workspace that could would be able to declare a year of real verifications to
 * have been tests. So the ask waits for somebody, and the card says it waits and for what.
 *
 * The panel's half is the answer, in one press. Everything after the decision is automatic,
 * including the first password, which exists in plain text on this screen and nowhere else
 * (SEC-10): it is in the result of the action, not in the address, so a refresh loses it and
 * the way back is a new password rather than a second look at the old one.
 */

export type SandboxStatus = 'NONE' | 'REQUESTED' | 'CREATED' | 'REFUSED';
export type SandboxRefusal = 'HAS_SANDBOX' | 'NOT_ELIGIBLE';

const REFUSAL_AR: Readonly<Record<SandboxRefusal, string>> = {
  HAS_SANDBOX: 'لمساحة عملك مساحة اختبار بالفعل، وواحدة تكفي.',
  NOT_ELIGIBLE: 'لم تُنشأ مساحة اختبار لهذا الاشتراك.',
};

const STATUS_TONES: Readonly<Record<Exclude<SandboxStatus, 'NONE'>, TagTone>> = {
  REQUESTED: 'neutral',
  CREATED: 'accent-2',
  REFUSED: 'critical',
};

const STATUS_LABELS: Readonly<Record<Exclude<SandboxStatus, 'NONE'>, string>> = {
  REQUESTED: 'بانتظار الإنشاء',
  CREATED: 'جاهزة',
  REFUSED: 'لم تُنشأ',
};

export interface SandboxAccessView {
  status: SandboxStatus;
  requestedAt: Date | null;
  decidedAt: Date | null;
  /** The workspace name to sign in to, once one exists. */
  sandboxSlug: string | null;
  refusalCode: SandboxRefusal | null;
  /** Whether the person looking holds developers.manage. */
  canAsk: boolean;
  /** Why the last press did nothing, in Arabic, or null. */
  refusalAr?: string | null;
}

/** The subscriber's card: ask for a sandbox, or read what happened to the ask. */
export function SandboxAccess({
  view,
  requestAction,
}: {
  view: SandboxAccessView;
  requestAction: string | ((formData: FormData) => void | Promise<void>);
}): ReactElement {
  const askable = view.status === 'NONE' || view.status === 'REFUSED';

  return (
    <Card role="sandbox-access" labelledBy="sandbox-access-title">
      <CardTitle as="h2" size="section" id="sandbox-access-title">
        مساحة الاختبار
      </CardTitle>
      <CardNote>
        مساحة عمل ثانية باسمك، لها مفاتيحها ورصيدها التجريبي، ولا تمسّ بيانات مساحتك الحقيقية ولا
        رصيدها.
      </CardNote>

      {view.refusalAr ? (
        <Notice tone="refused" role="sandbox-request-refused">
          {view.refusalAr}
        </Notice>
      ) : null}

      {view.status === 'NONE' ? null : (
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <Tag tone={STATUS_TONES[view.status]} role="sandbox-status">
            {STATUS_LABELS[view.status]}
          </Tag>
          {view.requestedAt ? (
            <StatHint>
              طُلبت في <Ltr>{isoDate(view.requestedAt)}</Ltr>
            </StatHint>
          ) : null}
        </div>
      )}

      {view.status === 'REQUESTED' ? (
        <StatHint role="sandbox-waiting">
          وصلنا الطلب. المساحة تُنشأ من لوحة المنصة لأن ربط مساحة عمل بأخرى ليس لمساحة العمل نفسها
          أن تفعله، وإلا استطاعت أن تعلن نفسها تجريبية بعد أن عملت. تظهر هنا باسمها حين تجهز.
        </StatHint>
      ) : null}

      {view.status === 'CREATED' && view.sandboxSlug ? (
        <div className="stack" data-role="sandbox-ready" style={{ gap: 'var(--space-2)' }}>
          <StatLabel>اسم مساحة العمل</StatLabel>
          <StatValue>
            <Ltr>{view.sandboxSlug}</Ltr>
          </StatValue>
          <StatHint>
            يدخلها من طلبها، ببريده نفسه، بكلمة مرور أولى يسلّمها له فريق المنصة ويُطلب تغييرها عند
            أول دخول. من عداه يحتاج حساباً فيها. مفاتيحها تبدأ بـ <Ltr>nx_test_</Ltr> ولا تصلح
            للإنتاج.
          </StatHint>
        </div>
      ) : null}

      {view.status === 'REFUSED' && view.refusalCode ? (
        <StatHint role="sandbox-refusal">{REFUSAL_AR[view.refusalCode]}</StatHint>
      ) : null}

      {askable && view.canAsk ? (
        <form action={requestAction}>
          <SubmitButton variant="secondary" data-role="request-sandbox" pendingLabel="جارٍ الإرسال">
            {view.status === 'REFUSED' ? 'اطلبها مرة أخرى' : 'اطلب مساحة اختبار'}
          </SubmitButton>
        </form>
      ) : null}

      {askable && !view.canAsk ? (
        <StatHint role="sandbox-needs-capability">
          طلب مساحة اختبار يحتاج صلاحية إدارة مفاتيح الربط.
        </StatHint>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------- panel */

export interface PendingSandboxView {
  id: string;
  tenantName: string;
  tenantSlug: string;
  requestedAt: Date;
  /** True when the workspace already has one, so this ask cannot be granted. */
  alreadyHasSandbox: boolean;
}

export interface SandboxAnswerState {
  made: {
    legalName: string;
    slug: string;
    /** Null when the ask carries no signed in person, so no account was made with it. */
    email: string | null;
    temporaryPassword: string | null;
  } | null;
  /** What was done, or why nothing was, in Arabic. */
  doneAr: string | null;
  refusalAr: string | null;
}

export const NO_SANDBOX_ANSWER: SandboxAnswerState = {
  made: null,
  doneAr: null,
  refusalAr: null,
};

/** The workspace that was just made, and the one time its first password exists in the open. */
export function MadeSandbox({
  made,
}: {
  made: NonNullable<SandboxAnswerState['made']>;
}): ReactElement {
  return (
    <Card variant="plain" tone="accent-2" role="made-sandbox">
      <CardTitle as="h3">{made.legalName}</CardTitle>
      <StatLabel>اسم مساحة العمل</StatLabel>
      <StatValue>
        <Ltr>{made.slug}</Ltr>
      </StatValue>
      {made.email && made.temporaryPassword ? (
        <>
          <StatLabel>الدخول الأول</StatLabel>
          <StatValue>
            <Ltr>{made.email}</Ltr>
          </StatValue>
          <code className="mono" dir="ltr" data-role="sandbox-temporary-password">
            {made.temporaryPassword}
          </code>
          <StatHint>
            سلّمها بقناة تثق بها، ولن تُعرض مرة أخرى. يُطلب تغييرها عند أول دخول، فلن تعرف أنت كلمة
            المرور بعدها.
          </StatHint>
        </>
      ) : (
        <StatHint role="sandbox-without-account">
          الطلب لا يحمل شخصاً وقّع عليه، فلم يُنشأ حساب دخول في المساحة. أضف له مستخدماً قبل
          تسليمها.
        </StatHint>
      )}
    </Card>
  );
}

/**
 * The asks waiting for an answer.
 *
 * A workspace that already has a sandbox gets no «أنشئ» button, because pressing it could only
 * fail: one sandbox per workspace is a unique index, not a preference. What it gets is the way
 * to close the ask with the reason the subscriber will read.
 */
export function PendingSandboxes({
  pending,
  answerAction,
}: {
  pending: PendingSandboxView[];
  answerAction: (previous: SandboxAnswerState, formData: FormData) => Promise<SandboxAnswerState>;
}): ReactElement {
  const [state, formAction] = useActionState(answerAction, NO_SANDBOX_ANSWER);

  return (
    <>
      {state.made ? <MadeSandbox made={state.made} /> : null}
      {state.doneAr ? (
        <Notice tone="done" role="sandbox-answer-done">
          {state.doneAr}
        </Notice>
      ) : null}
      {state.refusalAr ? (
        <Notice tone="refused" role="sandbox-answer-refused">
          {state.refusalAr}
        </Notice>
      ) : null}

      {pending.length === 0 ? (
        <Card variant="flush" label="طلبات مساحات الاختبار">
          <CardEmpty role="no-pending-sandboxes">لا طلبات مساحة اختبار بانتظار الإنشاء.</CardEmpty>
        </Card>
      ) : (
        <Card variant="flush" role="pending-sandboxes" label="طلبات مساحة اختبار">
          <div className="admin-table">
            <Table label="طلبات مساحة اختبار">
              <thead>
                <tr>
                  <Th>المشترك</Th>
                  <Th>مساحة العمل</Th>
                  <Th>تاريخ الطلب</Th>
                  <Th>الإجراء</Th>
                </tr>
              </thead>
              <tbody>
                {pending.map((request) => (
                  <tr key={request.id} data-role="pending-sandbox">
                    <td>{request.tenantName}</td>
                    <td>
                      <Ltr>{request.tenantSlug}</Ltr>
                    </td>
                    <td>
                      <Ltr>{isoDate(request.requestedAt)}</Ltr>
                    </td>
                    <td>
                      {request.alreadyHasSandbox ? (
                        <div className="stack" style={{ gap: 'var(--space-2)' }}>
                          <Tag tone="accent" role="sandbox-already">
                            لديه مساحة اختبار بالفعل
                          </Tag>
                          <form action={formAction} className="inline">
                            <input type="hidden" name="request_id" value={request.id} />
                            <input type="hidden" name="intent" value="refuse" />
                            <input type="hidden" name="reason" value="HAS_SANDBOX" />
                            <SubmitButton
                              variant="ghost"
                              data-role="close-sandbox-request"
                              pendingLabel="جارٍ الإغلاق"
                            >
                              أغلق الطلب
                            </SubmitButton>
                          </form>
                        </div>
                      ) : (
                        <div className="stack" style={{ gap: 'var(--space-2)' }}>
                          <form action={formAction} className="inline">
                            <input type="hidden" name="request_id" value={request.id} />
                            <input type="hidden" name="intent" value="create" />
                            <SubmitButton
                              variant="secondary"
                              data-role="create-sandbox"
                              pendingLabel="جارٍ الإنشاء"
                            >
                              أنشئ المساحة
                            </SubmitButton>
                          </form>
                          <Disclosure
                            summary="لا تُنشأ لهذا المشترك"
                            consequence="يُغلق الطلب ولا تُنشأ مساحة، ويقرأ المشترك أن الطلب لم يُقبل. يستطيع أن يطلبها من جديد."
                            role="refuse-sandbox"
                          >
                            <form action={formAction} className="inline">
                              <input type="hidden" name="request_id" value={request.id} />
                              <input type="hidden" name="intent" value="refuse" />
                              <input type="hidden" name="reason" value="NOT_ELIGIBLE" />
                              <SubmitButton
                                variant="ghost"
                                data-role="refuse-sandbox-confirm"
                                pendingLabel="جارٍ الإغلاق"
                              >
                                أكّد أنها لا تُنشأ
                              </SubmitButton>
                            </form>
                          </Disclosure>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}
    </>
  );
}
