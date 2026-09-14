import type { ReactElement } from 'react';
import { countOperatorAccounts } from '@nx-verify/core';
import { operatorPanelEnabled, operatorQuery } from '../../../lib/operator';
import { createFirstOwnerAction, operatorSignInAction } from './actions';
import { Brand } from '../../../components/brand';
import { Card, Field, Input, Ltr, Notice, SubmitButton } from '../../../components/ui';

/** Never prerendered: it reads the request and sets a cookie. */
export const dynamic = 'force-dynamic';

/**
 * The door to the administration panel.
 *
 * Staff sign in as themselves, with their address and password (PLAN.md, decision 5). A
 * panel with no account yet asks once for the deployment's token and makes its first owner;
 * after that the token opens nothing here. The page says nothing about who uses the panel or
 * how many people do, and a deployment without a token says that plainly instead of offering
 * a form that can never succeed.
 */

const ERRORS: Readonly<Record<string, string>> = {
  failed: 'البريد أو كلمة المرور غير صحيحة.',
  locked: 'أُوقف الدخول إلى هذا الحساب مؤقتاً بعد محاولات متكررة. حاول بعد 15 دقيقة.',
  token: 'رمز النشر غير صحيح.',
  password: 'كلمة المرور 12 حرفاً على الأقل.',
  invalid: 'تحقق من الاسم والبريد: الاسم من حرفين إلى 80 حرفاً، والبريد بصيغة صحيحة.',
  exists: 'للوحة مالك بالفعل. ادخل بحسابك.',
};

export default async function OperatorLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const error = (await searchParams)['error'];
  const message = typeof error === 'string' ? (ERRORS[error] ?? ERRORS['failed']) : null;
  const enabled = operatorPanelEnabled();

  let accounts: number | null = null;
  if (enabled) {
    try {
      accounts = await operatorQuery((db) => countOperatorAccounts(db));
    } catch {
      accounts = null;
    }
  }

  return (
    <div className="auth-frame" data-theme="dark">
      <Brand />
      <main id="main" className="operator-door">
        <Card role="operator-sign-in">
          <div className="operator-door-head">
            <h1 className="card-title">لوحة الإدارة</h1>
            <p className="page-subtitle">
              {accounts === 0 ? 'أول دخول: أنشئ حساب المالك.' : 'لفريق إدارة المنصة فقط.'}
            </p>
          </div>

          {!enabled ? (
            <Notice tone="refused" role="panel-disabled">
              لوحة الإدارة غير مفعّلة في هذا النشر. اضبط المتغير <Ltr>NX_OPERATOR_TOKEN</Ltr> بقيمة
              لا تقل عن 24 حرفاً ثم أعد التشغيل.
            </Notice>
          ) : accounts === null ? (
            <Notice tone="refused" role="panel-unreachable">
              تعذّر الوصول إلى قاعدة بيانات اللوحة. تحقق من المتغير{' '}
              <Ltr>NX_OPERATOR_DATABASE_URL</Ltr> ثم أعد المحاولة.
            </Notice>
          ) : accounts === 0 ? (
            <>
              {message === null || error === 'failed' ? null : (
                <Notice tone="refused" role="sign-in-error">
                  {message}
                </Notice>
              )}
              <form action={createFirstOwnerAction} className="operator-door-form">
                <Field
                  id="token"
                  label="رمز النشر"
                  hint={
                    <>
                      القيمة المضبوطة في <Ltr>NX_OPERATOR_TOKEN</Ltr>. تُطلب مرة واحدة.
                    </>
                  }
                >
                  {(control) => (
                    <Input
                      {...control}
                      name="token"
                      type="password"
                      required
                      autoComplete="off"
                      ltr
                    />
                  )}
                </Field>
                <Field id="display_name" label="الاسم">
                  {(control) => (
                    <Input
                      {...control}
                      name="display_name"
                      required
                      minLength={2}
                      maxLength={80}
                      autoComplete="name"
                    />
                  )}
                </Field>
                <Field id="email" label="البريد">
                  {(control) => (
                    <Input
                      {...control}
                      name="email"
                      type="email"
                      required
                      autoComplete="username"
                      ltr
                    />
                  )}
                </Field>
                <Field id="password" label="كلمة المرور" hint="12 حرفاً على الأقل.">
                  {(control) => (
                    <Input
                      {...control}
                      name="password"
                      type="password"
                      required
                      minLength={12}
                      autoComplete="new-password"
                      ltr
                    />
                  )}
                </Field>
                <SubmitButton
                  variant="primary"
                  block
                  data-role="first-owner-submit"
                  pendingLabel="جارٍ الإنشاء"
                >
                  إنشاء حساب المالك
                </SubmitButton>
              </form>
            </>
          ) : (
            <>
              {message === null ? null : (
                <Notice tone="refused" role="sign-in-error">
                  {message}
                </Notice>
              )}
              <form action={operatorSignInAction} className="operator-door-form">
                <Field id="email" label="البريد">
                  {(control) => (
                    <Input
                      {...control}
                      name="email"
                      type="email"
                      required
                      autoComplete="username"
                      ltr
                    />
                  )}
                </Field>
                <Field id="password" label="كلمة المرور">
                  {(control) => (
                    <Input
                      {...control}
                      name="password"
                      type="password"
                      required
                      autoComplete="current-password"
                      ltr
                    />
                  )}
                </Field>
                <SubmitButton
                  variant="primary"
                  block
                  data-role="operator-sign-in-submit"
                  pendingLabel="جارٍ الدخول"
                >
                  دخول
                </SubmitButton>
              </form>
            </>
          )}
        </Card>
      </main>
    </div>
  );
}
