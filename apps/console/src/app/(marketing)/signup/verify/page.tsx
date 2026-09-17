import type { ReactElement } from 'react';
import { SignupCodeForm } from '../../../../components/signup';
import { verifySignupAction } from '../actions';

/** Never prerendered: it reads the intent cookie and mints a session. */
export const dynamic = 'force-dynamic';

export default async function VerifySignupPage({
  searchParams,
}: {
  searchParams: Promise<{ refused?: string }>;
}): Promise<ReactElement> {
  const { refused } = await searchParams;
  return <SignupCodeForm refused={refused} action={verifySignupAction} />;
}
