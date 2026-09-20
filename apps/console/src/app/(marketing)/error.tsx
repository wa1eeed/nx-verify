'use client';

import type { ReactElement } from 'react';
import { FramedErrorState } from '../../components/error-state';

/**
 * The front door, and the sign up behind it (ADR-187).
 *
 * This is the one surface meant to be found, so its failure is met by somebody who has not
 * decided about us yet. Sign up reads and writes: a workspace, a first user, a code sent to
 * an address. Any of those can fail, and the framework's default page is the worst possible
 * first impression, because it is also the least informative: it does not say whether the
 * account was created.
 *
 * So the sentence claims nothing about what was or was not recorded, only that the screen
 * could not be drawn and that a retry is worth making. The group's layout is a fragment, so
 * the frame comes from here.
 */
export default function MarketingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  return <FramedErrorState audience="visitor" digest={error.digest} onRetry={reset} />;
}
