'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactElement } from 'react';
import { holdActivity } from '../lib/navigation-activity';
import { loadingShapeOf } from './loading-screen';
import { LoadingState } from './states';

/**
 * What a frame shows while a screen's data is read: the loading.tsx of the portal and of the
 * panel (unit C4).
 *
 * The shapes of the screen on its way, chosen from its path, since the address has already
 * moved when this is on screen. While it is mounted it holds the console busy, which keeps the
 * bar along the top running and the frame's data loader naming the screen, in the same place
 * it stood while the move was still being asked for.
 */
export function RouteLoading(): ReactElement {
  const pathname = usePathname();

  useEffect(() => holdActivity('loading'), []);

  return <LoadingState shape={loadingShapeOf(pathname ?? '')} announce={false} />;
}

/**
 * True once this long has passed since `since` last changed, and false while it is null: the
 * clock of one wait, which starts again when a new wait replaces it.
 */
export function useElapsed(ms: number, since: string | number | null): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    setElapsed(false);
    if (since === null) {
      return undefined;
    }
    const timer = window.setTimeout(() => setElapsed(true), ms);
    return () => window.clearTimeout(timer);
  }, [ms, since]);
  return elapsed;
}
