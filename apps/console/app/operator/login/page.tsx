import type { ReactElement } from 'react';
import { operatorPanelEnabled } from '../../../lib/operator';
import { operatorSignInAction } from './actions';

/** Never prerendered: it reads the request and sets a cookie. */
export const dynamic = 'force-dynamic';

/**
 * The door to the administration panel.
 *
 * One field and one button. It says nothing about who uses the panel or how many people
 * do, and a deployment without a token says that plainly instead of offering a form that
 * can never succeed.
 */
export default async function OperatorLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const failed = (await searchParams)['error'] !== undefined;
  const enabled = operatorPanelEnabled();

  return (
    <div className="auth-frame">
      <div className="brand auth-brand">
        <span className="brand-mark" aria-hidden="true">
          NX
        </span>
        <span>NX Trust</span>
      </div>
      <main id="main">
        <section
          className="card stack"
          data-role="operator-sign-in"
          style={{ width: 'min(26rem, 100%)', gap: 'var(--s-4)' }}
        >
          <div>
            <h1>لوحة الإدارة</h1>
            <p className="muted">للعاملين في NX فقط.</p>
          </div>

          {!enabled ? (
            <p className="sign-in-error" role="alert" data-role="panel-disabled">
              لوحة الإدارة غير مفعّلة في هذا النشر. اضبط المتغير{' '}
              <bdi dir="ltr" className="mono">
                NX_OPERATOR_TOKEN
              </bdi>{' '}
              بقيمة لا تقل عن 24 حرفاً ثم أعد التشغيل.
            </p>
          ) : (
            <>
              {failed ? (
                <p className="sign-in-error" role="alert" data-role="sign-in-error">
                  رمز الدخول غير صحيح.
                </p>
              ) : null}
              <form action={operatorSignInAction} method="post" className="stack">
                <label htmlFor="token">رمز الدخول</label>
                <input
                  id="token"
                  name="token"
                  type="password"
                  required
                  autoComplete="off"
                  dir="ltr"
                  className="mono"
                />
                <button type="submit" className="btn-primary" data-role="operator-sign-in-submit">
                  دخول
                </button>
              </form>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
