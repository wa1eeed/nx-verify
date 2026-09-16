import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignInCode } from '../../../../components/sign-in-code';
import { PENDING_COOKIE, readPending } from '../../../../lib/auth';
import { abandonCodeAction, codeSignInAction } from './actions';

/** Never prerendered: it reads a cookie and sets one. */
export const dynamic = 'force-dynamic';

/** The same sentence for every refusal, like the first step. */
const WRONG_CODE = 'الرمز غير صحيح أو انتهت مدته. ابدأ من جديد.';

export default async function LoginCodePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  // No sign in in progress is not an error to explain, it is the first step.
  if (readPending((await cookies()).get(PENDING_COOKIE)?.value) === null) {
    redirect('/login');
  }
  const params = await searchParams;

  return (
    <SignInCode
      error={params['error'] === undefined ? null : WRONG_CODE}
      action={codeSignInAction}
      backAction={abandonCodeAction}
    />
  );
}
