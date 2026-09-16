'use server';

import { redirect } from 'next/navigation';
import {
  NxError,
  authenticateOperator,
  confirmSecondFactorEnrolment,
  createFirstOwner,
  getOperatorAccount,
  masterKeySourceFromEnv,
  verifyOperatorSecondFactor,
  type OperatorAccount,
} from '@nx-verify/core';
import type { SecondFactorState } from '../../../components/operator-second-factor';
import {
  endOperatorSecondStep,
  operatorQuery,
  operatorTokenMatches,
  pendingOperator,
  startOperatorSecondStep,
  startOperatorSession,
} from '../../../lib/operator';

/**
 * Signing in to the administration panel, as a named member of staff (PLAN.md, decision 5).
 *
 * Two steps, and the panel opens only after both (SEC-02). The password is checked here, and
 * what the browser keeps until the second step is a short lived value that opens no screen: it
 * says only that this account gave the right password a moment ago. The code from the
 * authenticator finishes it, and what the browser keeps then is a sealed session naming the
 * account, the version of its credentials and its expiry. Both cookies are scoped to the panel's
 * own path, so neither is ever sent with a subscriber's requests.
 *
 * Every failure gets the same answer, whether the address is unknown, the password wrong or
 * the account disabled. A locked account is the one exception worth saying, because the
 * person locked out needs to know that trying again now will not help.
 */
export async function operatorSignInAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  let account: OperatorAccount | null = null;
  let reason = 'failed';
  try {
    account = await operatorQuery((db) => authenticateOperator(db, email, password));
  } catch (error) {
    if (error instanceof NxError && error.code === 'NX-4029') {
      reason = 'locked';
    } else if (!(error instanceof NxError)) {
      throw error;
    }
  }

  if (account === null) {
    redirect(`/operator/login?error=${reason}`);
  }
  // The password alone opens nothing: an account with an authenticator proves it, and one
  // without enrols before it reaches a single screen.
  await startOperatorSecondStep(account.id, account.secondFactorAt === null ? 'enrol' : 'verify');
  redirect('/operator/login/code');
}

/**
 * The code from the authenticator, or a recovery code, which finishes the sign in.
 *
 * A successful sign in never returns: it redirects into the panel. The recovery codes of a
 * finished enrolment are returned to the screen that asked and to nothing else, so they are
 * written into one page once and are in no address, no cookie and no log (the reasoning of
 * SEC-10).
 */
export async function operatorCodeAction(
  _previous: SecondFactorState,
  formData: FormData,
): Promise<SecondFactorState> {
  const pending = await pendingOperator();
  if (pending === null) {
    redirect('/operator/login?error=expired');
  }
  const code = String(formData.get('code') ?? '');

  let account: OperatorAccount | null = null;
  let recoveryCodes: string[] = [];
  try {
    const outcome = await operatorQuery(async (db) => {
      const keys = masterKeySourceFromEnv();
      let codes: string[] = [];
      if (pending.stage === 'enrol') {
        codes = (await confirmSecondFactorEnrolment(db, keys, pending.accountId, code))
          .recoveryCodes;
      } else {
        await verifyOperatorSecondFactor(db, keys, pending.accountId, code);
      }
      return { codes, account: await getOperatorAccount(db, pending.accountId) };
    });
    recoveryCodes = outcome.codes;
    account = outcome.account;
  } catch (error) {
    if (!(error instanceof NxError)) {
      throw error;
    }
    return { status: 'error', recoveryCodes: [], at: Date.now() };
  }

  if (account === null || account.status !== 'ACTIVE') {
    await endOperatorSecondStep();
    redirect('/operator/login?error=failed');
  }
  if (pending.stage === 'enrol') {
    // The codes are shown once, on the page that asked for them, and the panel is a press away.
    // The sign in is not finished here: the half finished value is left in place so this page
    // still renders, and «حفظتها» below turns it into a session.
    return { status: 'enrolled', recoveryCodes, at: Date.now() };
  }
  await startOperatorSession(account.id, account.credentialVersion);
  redirect('/operator');
}

/**
 * Leaving the recovery codes behind, which is what finishes an enrolment.
 *
 * Both factors are already proved: the half finished value says the password was right minutes
 * ago, and the account has an authenticator because a code from it was just checked. So this
 * opens the session the enrolment did not.
 */
export async function enterPanelAction(): Promise<void> {
  const pending = await pendingOperator();
  if (pending === null) {
    redirect('/operator/login?error=expired');
  }
  const account = await operatorQuery((db) => getOperatorAccount(db, pending.accountId));
  if (account === null || account.status !== 'ACTIVE' || account.secondFactorAt === null) {
    await endOperatorSecondStep();
    redirect('/operator/login?error=failed');
  }
  await startOperatorSession(account.id, account.credentialVersion);
  redirect('/operator');
}

/** Giving up halfway: the half finished sign in is dropped rather than left to expire. */
export async function abandonSignInAction(): Promise<void> {
  await endOperatorSecondStep();
  redirect('/operator/login');
}

/**
 * The first owner, made with the deployment's token while the panel has no account.
 *
 * The token proves the person holds the deployment; the account they make is then the only
 * way in, and staff after them are added by an owner from inside the panel. Once an account
 * exists this refuses, whoever holds the token. The new owner enrols an authenticator before
 * the panel opens, like everybody else.
 */
export async function createFirstOwnerAction(formData: FormData): Promise<void> {
  const presented = String(formData.get('token') ?? '');
  if (!operatorTokenMatches(presented)) {
    // The token is long enough that guessing it is not a plan, and the pause costs a person
    // nothing.
    await new Promise((resolve) => setTimeout(resolve, 400));
    redirect('/operator/login?error=token');
  }

  let account: OperatorAccount | null = null;
  let reason = 'invalid';
  try {
    account = await operatorQuery((db) =>
      createFirstOwner(db, {
        email: String(formData.get('email') ?? ''),
        displayName: String(formData.get('display_name') ?? ''),
        password: String(formData.get('password') ?? ''),
      }),
    );
  } catch (error) {
    if (!(error instanceof NxError)) {
      throw error;
    }
    reason =
      error.code === 'NX-4001' ? 'password' : error.code === 'NX-4091' ? 'exists' : 'invalid';
  }

  if (account === null) {
    redirect(`/operator/login?error=${reason}`);
  }
  await startOperatorSecondStep(account.id, 'enrol');
  redirect('/operator/login/code');
}
