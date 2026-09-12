import type { ReactElement } from 'react';

/**
 * Changing the password.
 *
 * Reached on the first sign in with a password somebody else chose, and from the account
 * menu afterwards. The current one is required even though the person is already signed
 * in, because a session left open on a shared machine should not be enough to take an
 * account.
 */

export interface ChangePasswordProps {
  error?: string | null;
  /** True when this is the forced change after a temporary password. */
  forced?: boolean;
  action: string | ((formData: FormData) => void | Promise<void>);
}

export function ChangePassword({ error, forced, action }: ChangePasswordProps): ReactElement {
  return (
    <section
      className="card stack"
      data-role="change-password"
      style={{ width: 'min(26rem, 100%)', gap: 'var(--s-4)' }}
    >
      <h1>تغيير كلمة المرور</h1>
      {forced ? (
        <p className="muted" data-role="forced-notice">
          كلمة المرور الحالية مؤقتة وأنشأها شخص آخر. اخترْ واحدة قبل المتابعة.
        </p>
      ) : null}

      {error ? (
        <p className="sign-in-error" data-role="change-password-error" role="alert">
          {error}
        </p>
      ) : null}

      <form action={action} method="post" className="stack">
        <label htmlFor="current">كلمة المرور الحالية</label>
        <input id="current" name="current" type="password" required autoComplete="current-password" dir="ltr" />

        <label htmlFor="next">كلمة المرور الجديدة</label>
        <input id="next" name="next" type="password" required autoComplete="new-password" dir="ltr" />
        <p className="muted">اثنتا عشرة خانة على الأقل. عبارة تذكرها خير من كلمة معقّدة تنساها.</p>

        <button type="submit" className="btn-primary" data-role="change-password-submit">
          حفظ
        </button>
      </form>
    </section>
  );
}
