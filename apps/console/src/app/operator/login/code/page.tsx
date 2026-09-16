import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { getOperatorAccount, masterKeySourceFromEnv, startSecondFactorEnrolment } from '@nx-verify/core';
import { qrSvg } from '@nx-verify/core';
import { operatorQuery, pendingOperator } from '../../../../lib/operator';
import { Brand } from '../../../../components/brand';
import { Card } from '../../../../components/ui';
import { SecondFactorForm } from '../../../../components/operator-second-factor';
import { abandonSignInAction, enterPanelAction, operatorCodeAction } from '../actions';

/** Never prerendered: it reads the half finished sign in from the request. */
export const dynamic = 'force-dynamic';

/**
 * The second step of a sign in to the panel (SEC-02).
 *
 * A member of staff with an authenticator types the six digits it shows, or one of the recovery
 * codes they were given. A member without one enrols here and cannot go further until they do:
 * the panel decides prices, sees every subscriber and moves balances, and a password that leaks
 * must not be enough to open it.
 *
 * The secret is drawn into the page by the server, as a code to scan and as text to type, and
 * is never fetched from anywhere. Reloading shows the same secret, not a new one.
 *
 * Whether this is an enrolment is read from the account rather than from the cookie, because
 * this page renders again the moment the enrolment finishes, and by then the account has an
 * authenticator: asking to start another would refuse, and the refusal would take the recovery
 * codes with it.
 */
export default async function OperatorCodePage(): Promise<ReactElement> {
  const pending = await pendingOperator();
  if (pending === null) {
    redirect('/operator/login?error=expired');
  }

  const account = await operatorQuery((db) => getOperatorAccount(db, pending.accountId));
  if (account === null || account.status !== 'ACTIVE') {
    redirect('/operator/login?error=failed');
  }

  const enrolling = account.secondFactorAt === null;
  const enrolment = enrolling
    ? await operatorQuery((db) =>
        startSecondFactorEnrolment(db, masterKeySourceFromEnv(), pending.accountId),
      )
    : null;
  const qr = enrolment === null ? null : await qrSvg(enrolment.uri);

  return (
    <div className="auth-frame" data-theme="dark">
      <Brand />
      <main id="main" className="operator-door">
        <Card role="operator-second-factor">
          <div className="operator-door-head">
            <h1 className="card-title">{enrolling ? 'تفعيل المصادقة الثنائية' : 'رمز التحقق'}</h1>
            <p className="page-subtitle">
              {enrolling
                ? 'امسح الرمز بتطبيق المصادقة، ثم أدخل الرقم الذي يعرضه.'
                : `أدخل الرقم الذي يعرضه تطبيق المصادقة لحساب ${account.displayName}.`}
            </p>
          </div>

          <SecondFactorForm
            enrolling={enrolling}
            secret={enrolment?.secret ?? null}
            qr={qr}
            action={operatorCodeAction}
            abandon={abandonSignInAction}
            enterPanel={enterPanelAction}
          />
        </Card>
      </main>
    </div>
  );
}
