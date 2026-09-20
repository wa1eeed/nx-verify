'use client';

import type { ReactElement } from 'react';
import { FramedErrorState } from '../components/error-state';

/**
 * The last boundary, under every address this application answers (ADR-187).
 *
 * A boundary catches what its own segment's children throw, and not what the layout beside it
 * throws. `(app)/error.tsx` therefore never covered `(app)/layout.tsx`, which is the frame
 * every signed in screen is drawn inside and which reads a session, a workspace and a set of
 * capabilities of its own: the one file whose failure takes every screen with it was the one
 * file no boundary stood above. The panel has the same hole closed one level up (ADR-186);
 * this closes the portal's, and covers the few addresses that belong to no group.
 *
 * It renders with the brand and no navigation, because the navigation is often precisely what
 * failed, and a sidebar drawn around an error invites a person to press a link that will fail
 * the same way.
 *
 * The one thing above this is the root layout itself. A failure there is a document with no
 * body, which no React boundary inside that document can answer.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  return <FramedErrorState audience="visitor" digest={error.digest} onRetry={reset} />;
}
