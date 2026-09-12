import type { ReactElement, ReactNode } from 'react';
import { sandboxLink } from '@nx-verify/core';
import { Shell } from '../../components/shell';
import { query } from '../../lib/context';

/**
 * The shell, with the one fact it needs.
 *
 * Which workspace this is decides whether every screen carries the sandbox band, and that
 * is read here rather than inside the shell so the shell stays renderable without a
 * database.
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const workspace = await query((tx) => sandboxLink(tx));
  return <Shell isSandbox={workspace.isSandbox}>{children}</Shell>;
}
