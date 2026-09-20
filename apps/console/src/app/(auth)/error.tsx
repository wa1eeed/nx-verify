'use client';

import type { ReactElement } from 'react';
import { ErrorState } from '../../components/error-state';

/**
 * The door, when the door itself cannot be drawn (ADR-187).
 *
 * Signing in reads a session, a workspace and whether a password must be changed, and every
 * one of those is a database read on a screen whose reader has no session to fall back on.
 * Without a boundary here the framework's default page stood between a customer and the only
 * way into the platform, in English, with nothing to press.
 *
 * The visitor wording, not the member's: nobody here has an account in hand yet, so there is
 * no account to promise is untouched.
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  return <ErrorState audience="visitor" digest={error.digest} onRetry={reset} />;
}
