'use client';

import { usePathname } from 'next/navigation';
import { useRef, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import {
  activitySnapshot,
  serverActivitySnapshot,
  subscribeActivity,
} from '../lib/navigation-activity';
import { loadingSubjectOf } from './loading-screen';
import { useElapsed } from './route-loading';
import { DataLoader, LOADER_WORDS, SLOW_AFTER_MS } from './ui/data-loader';

/**
 * The content side of the frame, which says when what it shows is about to change (unit C4).
 *
 * One data loader for the whole wait, standing at the top of the content in one place from
 * the click until the screen is ready, so it never jumps or blinks between steps:
 *
 * - While the move is still being asked for, the router keeps the screen it started from, and
 *   for the next page of a list or a new filter that is the whole wait. That screen fades back
 *   under the loader, which names the screen on its way, or says the results are being
 *   refreshed when it is the same screen.
 * - Once the loading shapes of the next screen take over, the loader names the screen from the
 *   address, which has moved by then.
 *
 * The content stays usable while it fades: a person who changes their mind clicks elsewhere,
 * and that move replaces this one.
 */
export function FrameMain({ children }: { children: ReactNode }): ReactElement {
  const activity = useSyncExternalStore(
    subscribeActivity,
    activitySnapshot,
    serverActivitySnapshot,
  );
  const pathname = usePathname() ?? '';
  const navigation = activity.navigation;
  const loading = activity.loading > 0;
  const waiting = navigation !== null || loading;

  // One clock for the whole wait: it starts with the move, or with the loading screen when
  // nothing was asked for first (a reload), and stops when the screen is ready.
  const started = useRef<number | null>(null);
  if (!waiting) {
    started.current = null;
  } else if (started.current === null) {
    started.current = navigation?.startedAt ?? Date.now();
  }
  const slow = useElapsed(SLOW_AFTER_MS, waiting ? started.current : null);

  const fading = navigation !== null && !loading;
  const subject = loadingSubjectOf(
    navigation !== null && !loading
      ? new URL(navigation.target, 'http://console.local').pathname
      : pathname,
  );
  const detail = slow
    ? LOADER_WORDS.slow
    : navigation !== null && navigation.sameScreen && !loading
      ? LOADER_WORDS.refreshing
      : LOADER_WORDS.fetching;

  return (
    <main
      className="frame-main"
      id="main"
      aria-busy={waiting ? true : undefined}
      data-pending={fading ? '' : undefined}
    >
      {waiting ? (
        <div className="loader-float">
          <DataLoader title={subject} detail={detail} />
        </div>
      ) : null}
      {children}
    </main>
  );
}
