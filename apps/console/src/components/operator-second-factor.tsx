'use client';

import { useActionState, type ReactElement } from 'react';
import { Field } from './ui/field';
import { Input } from './ui/input';
import { Ltr } from './ui/ltr';
import { Notice } from './ui/notice';
import { SubmitButton } from './ui/submit-button';

/**
 * The second step of a sign in to the panel, as a screen (SEC-02).
 *
 * Enrolling: the code to scan and the same secret as text, then the first six digits the
 * authenticator shows. What comes back is the ten recovery codes, written into this page once
 * and nowhere else: not into the address, not into a cookie, not into a log. The panel opens
 * from here once they have been kept.
 *
 * Signing in: the six digits, or one of those recovery codes when the authenticator is lost.
 */

export interface SecondFactorState {
  status: 'idle' | 'error' | 'enrolled';
  /** Returned once, when an enrolment finishes. */
  recoveryCodes: string[];
  at: number;
}

const IDLE: SecondFactorState = { status: 'idle', recoveryCodes: [], at: 0 };

export function SecondFactorForm({
  enrolling,
  secret,
  qr,
  action,
  abandon,
  enterPanel,
}: {
  enrolling: boolean;
  /** The secret in groups of four, for an authenticator that cannot scan. */
  secret: string | null;
  /** The QR code as an SVG, drawn by the server. */
  qr: string | null;
  action: (previous: SecondFactorState, formData: FormData) => Promise<SecondFactorState>;
  abandon: (formData: FormData) => Promise<void>;
  /** Finishes an enrolment: the codes have been kept, so open the panel. */
  enterPanel: (formData: FormData) => Promise<void>;
}): ReactElement {
  const [state, formAction] = useActionState(action, IDLE);

  if (state.status === 'enrolled') {
    return (
      <div className="operator-door-form" data-role="recovery-codes">
        <Notice tone="done" role="second-factor-enrolled">
          فُعّلت المصادقة الثنائية لحسابك.
        </Notice>
        <p className="page-subtitle">
          احفظ رموز الاسترداد في مكان آمن. كل رمز يعمل مرة واحدة، ولن تُعرض مرة أخرى.
        </p>
        <ul className="recovery-list">
          {state.recoveryCodes.map((code) => (
            <li key={code}>
              <Ltr>{code}</Ltr>
            </li>
          ))}
        </ul>
        <form action={enterPanel}>
          <SubmitButton variant="primary" block data-role="enter-panel" pendingLabel="جارٍ الفتح">
            حفظتها، افتح اللوحة
          </SubmitButton>
        </form>
      </div>
    );
  }

  return (
    <form action={formAction} className="operator-door-form">
      {state.status === 'error' ? (
        <Notice tone="refused" role="second-factor-error">
          الرمز غير صحيح أو انتهت صلاحيته. جرّب الرمز الحالي في التطبيق.
        </Notice>
      ) : null}

      {enrolling && qr !== null ? (
        <div className="second-factor-secret">
          <div
            className="second-factor-qr"
            data-role="second-factor-qr"
            aria-label="رمز الإعداد"
            role="img"
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          {secret === null ? null : (
            <p className="second-factor-key" data-role="second-factor-secret">
              <span>أو أدخل المفتاح يدوياً</span>
              <Ltr>{secret}</Ltr>
            </p>
          )}
        </div>
      ) : null}

      <Field
        id="code"
        label={enrolling ? 'الرمز من التطبيق' : 'رمز التحقق'}
        hint={enrolling ? 'ستة أرقام تتغير كل 30 ثانية.' : 'ستة أرقام، أو أحد رموز الاسترداد.'}
      >
        {(control) => (
          <Input
            {...control}
            name="code"
            required
            ltr
            inputMode={enrolling ? 'numeric' : 'text'}
            autoComplete="one-time-code"
            maxLength={19}
            autoFocus
          />
        )}
      </Field>

      <SubmitButton
        variant="primary"
        block
        data-role="second-factor-submit"
        pendingLabel="جارٍ التحقق"
      >
        {enrolling ? 'تفعيل ودخول' : 'دخول'}
      </SubmitButton>

      {/* One form: the way back submits the same form to a different action, rather than a
          second form inside this one, which no browser allows. */}
      <SubmitButton variant="ghost" block formAction={abandon} data-role="abandon-sign-in">
        رجوع
      </SubmitButton>
    </form>
  );
}
