'use client';

import type { ReactElement } from 'react';
import { ErrorState } from '../../../components/error-state';

export default function ScreenError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  return <ErrorState digest={error.digest} onRetry={reset} />;
}
