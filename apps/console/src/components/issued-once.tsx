'use client';

import { useActionState, type ReactElement, type ReactNode } from 'react';
import { Panel } from './page-header';
import { ROLE_HINTS, ROLE_LABELS } from './roles';
import type { UserRole } from '@nx-verify/core';

/**
 * The three values this console shows once and never again: an API key, the temporary
 * password of a new account, and a link that opens part of a customer's file (SEC-10).
 *
 * Both used to travel back in the address of the page that displays them, which put them in
 * the browser's history, in the referrer of the next request, and in the access log of every
 * proxy between here and there: three places a secret outlives the screen that shows it. They
 * come back in the result of the action that made them instead, which reaches the page that
 * asked and nothing else.
 *
 * The forms are here rather than in the screen because only a client component can hold the
 * result of an action; what the result looks like stays in the small components below, which
 * a test renders on their own.
 */

export interface IssuedKeyState {
  secret: string | null;
}

export interface IssuedPasswordState {
  account: { email: string; password: string } | null;
  /** Why nothing was created, in Arabic, or null. */
  refusalAr: string | null;
}

const NO_KEY: IssuedKeyState = { secret: null };
const NO_ACCOUNT: IssuedPasswordState = { account: null, refusalAr: null };

/** The new key, in the one place it exists in plain text. */
export function IssuedKey({ secret }: { secret: string }): ReactElement {
  return (
    <section className="card stack" data-role="issued-secret">
      <strong>المفتاح الجديد</strong>
      <bdi dir="ltr" className="mono" data-role="secret-value">
        {secret}
      </bdi>
      <p className="muted">
        انسخه الآن. لا نخزّنه، ولا يمكن عرضه مرة أخرى. فقده يعني إصدار مفتاح بديل، وهذا هو الجواب
        الصحيح لا نقصاً في المنصة.
      </p>
    </section>
  );
}

export function IssueApiKey({
  action,
}: {
  action: (previous: IssuedKeyState, formData: FormData) => Promise<IssuedKeyState>;
}): ReactElement {
  const [state, formAction] = useActionState(action, NO_KEY);
  return (
    <>
      {state.secret === null ? null : <IssuedKey secret={state.secret} />}
      <Panel title="إصدار مفتاح">
        <form action={formAction} className="panel-body stack">
          <label htmlFor="key-name">الاسم</label>
          <input id="key-name" name="name" required placeholder="نظام الفوترة" />
          <p className="muted">
            الصلاحيات تُمنح كما هي لباقي مفاتيح مساحة العمل. البيئة تتبع مساحة العمل التي أنت فيها،
            فلا يمكن إصدار مفتاح إنتاج من بيئة الاختبار.
          </p>
          <button type="submit" className="btn btn-primary" data-role="issue-key">
            إصدار
          </button>
        </form>
      </Panel>
    </>
  );
}

/** The temporary password of a new account, shown to whoever made it and to nobody else. */
export function IssuedPassword({
  email,
  password,
}: {
  email: string;
  password: string;
}): ReactElement {
  return (
    <section
      className="card stack"
      data-role="issued-password"
      style={{
        gap: 'var(--s-2)',
        border: '1px solid var(--fresh-line)',
        background: 'var(--fresh-bg)',
      }}
    >
      <strong>كلمة مرور مؤقتة لـ {email}</strong>
      <code className="mono" dir="ltr" data-role="temporary-password">
        {password}
      </code>
      <span className="stat-hint">
        سلّمها بقناة تثق بها، ولن تُعرض مرة أخرى. سيُطلب منه تغييرها عند أول دخول، فلن تعرف أنت كلمة
        مروره بعدها.
      </span>
    </section>
  );
}

export function AddPerson({
  action,
}: {
  action: (previous: IssuedPasswordState, formData: FormData) => Promise<IssuedPasswordState>;
}): ReactElement {
  const [state, formAction] = useActionState(action, NO_ACCOUNT);
  return (
    <>
      {state.account === null ? null : (
        <IssuedPassword email={state.account.email} password={state.account.password} />
      )}
      {state.refusalAr === null ? null : (
        <p className="muted" data-role="create-user-refused">
          {state.refusalAr}
        </p>
      )}
      <section className="card stack" data-role="invite" style={{ gap: 'var(--s-3)' }}>
        <div>
          <h2 style={{ margin: 0 }}>إضافة شخص</h2>
          <p className="faint" style={{ margin: 0 }}>
            يدخل ببريده وكلمة مرور مؤقتة، ويغيّرها عند أول دخول.
          </p>
        </div>
        <form action={formAction} className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
          <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '200px' }}>
            <span className="stat-label">البريد</span>
            <input name="email" type="email" dir="ltr" className="mono" required />
          </label>
          <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '160px' }}>
            <span className="stat-label">الاسم</span>
            <input name="display_name" required />
          </label>
          <label className="stack" style={{ gap: 'var(--s-1)' }}>
            <span className="stat-label">الدور</span>
            <select name="role" defaultValue="ANALYST" style={{ width: 'auto' }}>
              {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-primary" data-role="create-user">
            إضافة
          </button>
        </form>
        <ul className="stack faint" style={{ gap: 'var(--s-1)', margin: 0 }}>
          {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
            <li key={role}>
              <strong>{ROLE_LABELS[role]}</strong>: {ROLE_HINTS[role]}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export interface IssuedShareState {
  /** The whole link, once, straight after issuing. Never fetched, never stored. */
  link: string | null;
  /** Where it went instead, when it left by mail. The link itself is not shown then. */
  sentTo: string | null;
  /** Why nothing was issued: a mistyped address, or mail that could not leave. */
  refused: 'address' | 'mail' | null;
}

const NO_LINK: IssuedShareState = { link: null, sentTo: null, refused: null };

const REFUSALS: Record<NonNullable<IssuedShareState['refused']>, string> = {
  address: 'لم يُرسل شيء: راجع البريد المكتوب.',
  mail: 'تعذّر إرسال البريد، وسُحب الرابط. جرّب لاحقاً أو أصدره بلا بريد وانسخه بنفسك.',
};

/** What happened, when it was not a link on the screen. */
export function ShareOutcome({ state }: { state: IssuedShareState }): ReactElement | null {
  if (state.refused !== null) {
    return (
      <p className="notice notice-refused" data-role="share-refused" style={{ margin: 0 }}>
        {REFUSALS[state.refused]}
      </p>
    );
  }
  if (state.sentTo !== null) {
    return (
      <p className="notice notice-done" data-role="share-sent" style={{ margin: 0 }}>
        أُرسل الرابط إلى{' '}
        <bdi dir="ltr" className="mono">
          {state.sentTo}
        </bdi>
        . لن يُعرض هنا: النسخة الوحيدة في ذلك البريد.
      </p>
    );
  }
  return null;
}

/** The link, in the one place it exists after it is made. */
export function IssuedShareLink({ link }: { link: string }): ReactElement {
  return (
    <div
      className="stack"
      data-role="issued-link"
      style={{
        gap: 'var(--s-2)',
        border: '1px solid var(--fresh-line)',
        background: 'var(--fresh-bg)',
        borderRadius: 'var(--radius)',
        padding: 'var(--s-3)',
      }}
    >
      <strong>انسخ الرابط الآن</strong>
      <code className="mono" dir="ltr" data-role="share-link" style={{ wordBreak: 'break-all' }}>
        {link}
      </code>
      <span className="stat-hint">
        لن يُعرض مرة أخرى. لا نحتفظ به، ولا يمكننا استخراجه. إن ضاع فاسحب الرابط وأصدر غيره.
      </span>
    </div>
  );
}

/**
 * The form that opens a link, with its fields drawn by the screen.
 *
 * Only the state lives here: what is shared, for how long and why is chosen on the server,
 * where the groups this customer actually has facts in are known, and passed straight through.
 */
export function ShareForm({
  action,
  children,
}: {
  action: (previous: IssuedShareState, formData: FormData) => Promise<IssuedShareState>;
  children: ReactNode;
}): ReactElement {
  const [issued, formAction] = useActionState(action, NO_LINK);
  return (
    <>
      {issued.link === null ? null : <IssuedShareLink link={issued.link} />}
      <ShareOutcome state={issued} />
      <form action={formAction} className="stack" style={{ gap: 'var(--s-3)' }}>
        {children}
      </form>
    </>
  );
}
