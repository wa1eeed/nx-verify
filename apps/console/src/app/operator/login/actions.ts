'use server';

import { redirect } from 'next/navigation';
import {
  NxError,
  authenticateOperator,
  createFirstOwner,
  type OperatorAccount,
} from '@nx-verify/core';
import { operatorQuery, operatorTokenMatches, startOperatorSession } from '../../../lib/operator';

/**
 * Signing in to the administration panel, as a named member of staff (PLAN.md, decision 5).
 *
 * The password is checked once, here, and what the browser keeps is a sealed value naming
 * the account that expires. The cookie is scoped to the panel's own path, so it is never sent
 * with a subscriber's requests, and it is strict about where it is sent from.
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
  await startOperatorSession(account.id);
  redirect('/operator');
}

/**
 * The first owner, made with the deployment's token while the panel has no account.
 *
 * The token proves the person holds the deployment; the account they make is then the only
 * way in, and staff after them are added by an owner from inside the panel. Once an account
 * exists this refuses, whoever holds the token.
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
  await startOperatorSession(account.id);
  redirect('/operator');
}
