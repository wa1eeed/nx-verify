import type { ReactElement } from 'react';

/**
 * The sign in screen.
 *
 * A login form is the most probed surface a platform has, and the two questions asked of
 * it are: does this address exist here, and can I keep guessing. So there is one message
 * for every failure, and the screen says nothing about which workspaces exist, which
 * addresses are registered, or which companies use a directory.
 *
 * One primary button, per the interface rules. The directory door is a secondary action
 * beside it, not a second primary.
 */

export interface SignInProps {
  /** Shown when a previous attempt failed. Always the same sentence. */
  error?: string | null;
  passwordAction: string | ((formData: FormData) => void | Promise<void>);
  ssoAction: string | ((formData: FormData) => void | Promise<void>);
}

export function SignIn({ error, passwordAction, ssoAction }: SignInProps): ReactElement {
  return (
    <section
      className="card stack"
      data-role="sign-in"
      style={{ width: 'min(26rem, 100%)', gap: 'var(--s-4)' }}
    >
      <div>
        <h1>تسجيل الدخول</h1>
        <p className="muted">ادخل إلى مساحة عملك في NX Verify.</p>
      </div>

      {error ? (
        <p className="sign-in-error" data-role="sign-in-error" role="alert">
          {error}
        </p>
      ) : null}

      <form action={passwordAction} method="post" className="stack">
        <label htmlFor="slug">معرّف مساحة العمل</label>
        <input
          id="slug"
          name="slug"
          required
          autoComplete="organization"
          dir="ltr"
          className="mono"
          placeholder="acme"
        />

        <label htmlFor="email">البريد</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          dir="ltr"
          className="mono"
        />

        <label htmlFor="password">كلمة المرور</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          dir="ltr"
        />

        <button type="submit" className="btn-primary" data-role="sign-in-submit">
          دخول
        </button>
      </form>

      <hr className="sign-in-divider" />

      <form action={ssoAction} method="post" className="stack" data-role="sso-form">
        <p className="muted">
          إن كانت شركتك تستخدم دليلاً موحّداً، ادخل بريد العمل وسنحوّلك إليه.
        </p>
        <label htmlFor="sso-email">بريد العمل</label>
        <input
          id="sso-email"
          name="email"
          type="email"
          required
          autoComplete="username"
          dir="ltr"
          className="mono"
        />
        <button type="submit" className="btn-secondary" data-role="sso-submit">
          الدخول عبر دليل شركتك
        </button>
      </form>
    </section>
  );
}
