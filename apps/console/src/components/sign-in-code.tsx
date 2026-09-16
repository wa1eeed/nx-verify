import type { ReactElement } from 'react';

/**
 * The second step of a subscriber's sign in (ADR-143).
 *
 * Six digits from a message. Written as its own small screen rather than a field on the
 * first one, because the two steps are two moments: the password is remembered and the code
 * is read off a phone, and a form that asks for both at once asks for the code before it
 * exists.
 *
 * It says nothing about the account. Not the address it was sent to, not whether one was
 * sent at all: somebody who reaches this screen with a stolen password must learn nothing
 * from it, and somebody who reaches it by accident has nothing here to read.
 */

export interface SignInCodeProps {
  error?: string | null;
  action: string | ((formData: FormData) => void | Promise<void>);
  backAction: string | ((formData: FormData) => void | Promise<void>);
}

export function SignInCode({ error, action, backAction }: SignInCodeProps): ReactElement {
  return (
    <section
      className="card stack"
      data-role="sign-in-code"
      style={{ width: 'min(26rem, 100%)', gap: 'var(--s-4)' }}
    >
      <div>
        <h1>رمز الدخول</h1>
        <p className="muted">
          أرسلنا رمزاً من ستة أرقام إلى بريدك. ينتهي بعد عشر دقائق ويُستعمل مرة واحدة.
        </p>
      </div>

      {error ? (
        <p className="sign-in-error" data-role="sign-in-error" role="alert">
          {error}
        </p>
      ) : null}

      <form action={action} className="stack">
        <label htmlFor="code">الرمز</label>
        <input
          id="code"
          name="code"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          dir="ltr"
          className="input input-ltr"
          data-role="code-field"
        />
        <button type="submit" className="btn btn-primary" data-role="submit-code">
          دخول
        </button>
      </form>

      <form action={backAction}>
        <button type="submit" className="btn btn-ghost" data-role="abandon-code">
          ابدأ من جديد
        </button>
      </form>
    </section>
  );
}
