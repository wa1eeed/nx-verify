import type { ReactElement } from 'react';
import { SignIn } from '../../../components/sign-in';
import { SIGN_IN_FAILED } from '../../../lib/auth';
import { passwordSignInAction, ssoSignInAction } from './actions';

/** Never prerendered: it sets a cookie and reads the request. */
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const params = await searchParams;
  // One flag, and one sentence. The reason a sign in failed is in our audit trail, not in
  // the visitor's address bar.
  const failed = params['error'] !== undefined;

  return (
    <SignIn
      error={failed ? SIGN_IN_FAILED : null}
      passwordAction={passwordSignInAction}
      ssoAction={ssoSignInAction}
    />
  );
}
