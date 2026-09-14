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
 */
export default async function OperatorPanelLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const operator = await operatorOrSignIn();
  return <OperatorShell operator={operator}>{children}</OperatorShell>;
}
