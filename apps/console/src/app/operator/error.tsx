'use client';

import type { ReactElement } from 'react';
import { Brand } from '../../components/brand';
import { ErrorState } from '../../components/error-state';

/**
 * The panel's outer boundary: what is left when the frame itself could not be drawn (ADR-186).
 *
 * There was already an `error.tsx` inside `(panel)`, and it catches what the screens throw. It
 * does not catch what the layout beside it throws, because a boundary handles its own segment's
 * children and not the layout it sits next to. So anything the frame reads for itself, and
 * anything `operatorOrSignIn` throws that is not a redirect, went past every boundary this
 * application has and landed on the framework's default error page: an English sentence, on a
 * white page, with no frame, no retry and no code to quote to support.
 *
 * This is the parent segment, so it catches those. It renders bare, without the panel's
 * navigation, which is the honest shape: the navigation is precisely what failed, and drawing
 * a sidebar full of links around an error would invite a member of staff to press one.
 *
 * It covers the sign in pages under `/operator` too, which had no boundary of their own either.
 */
export default function OperatorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  return (
    <div className="auth-frame" data-surface="operator">
      <Brand href="/operator" suffix="أدمن" />
      <main id="main" className="operator-door">
        <ErrorState digest={error.digest} onRetry={reset} />
      </main>
    </div>
  );
}
