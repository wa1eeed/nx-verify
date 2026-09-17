import type { ReactElement } from 'react';
import { SignupForm } from '../../../components/signup';
import { startSignupAction } from './actions';

/** Never prerendered: it sets a cookie and sends mail. */
export const dynamic = 'force-dynamic';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ refused?: string }>;
}): Promise<ReactElement> {
  const { refused } = await searchParams;
  return <SignupForm refused={refused} action={startSignupAction} />;
}
