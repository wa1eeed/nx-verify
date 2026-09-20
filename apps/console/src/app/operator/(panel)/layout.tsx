import type { ReactElement, ReactNode } from 'react';
import { OperatorShell } from '../../../components/operator-shell';
import { operatorOrSignIn } from '../../../lib/operator';

/** Never prerendered: who is signed in decides whether anything renders. */
export const dynamic = 'force-dynamic';

/**
 * Every panel screen sits behind this.
 *
 * The screens still check for themselves, and so does every action they post to. This
 * layer turns a missing sign in into the sign in page rather than an error, and it is not
 * the only thing standing between a stranger and a price list.
 *
 * What this layout throws is caught one segment up, in `app/operator/error.tsx`, and not by
 * the `error.tsx` beside it: a boundary catches what its segment's children throw, and a
 * layout is not its own child (ADR-186). Anything read here is read for every panel screen at
 * once, so it is worth asking of each addition whether the whole panel should go dark when it
 * fails. For the frame's own count the answer was no, and it catches its own failure.
 */
export default async function OperatorPanelLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const operator = await operatorOrSignIn();
  return <OperatorShell operator={operator}>{children}</OperatorShell>;
}
