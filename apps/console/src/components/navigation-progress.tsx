'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import {
  activitySnapshot,
  addressOf,
  beginNavigation,
  endNavigation,
  isBusy,
  serverActivitySnapshot,
  subscribeActivity,
} from '../lib/navigation-activity';

/**
 * The thin bar along the top of the window while the console is busy (unit C4, ADR-120).
 *
 * It notices a move the moment it is asked for: a link the router took over, which it marks by
 * preventing the browser's own navigation, or a search form the router submits. It keeps
 * running while a loading screen is up or a form action runs, and finishes when the console
 * settles. A move that lands at once draws nothing, because the bar waits a beat before it
 * shows.
 *
 * It creeps towards the end without reaching it, since nobody knows how long a query takes,
 * then fills and fades. For a person who asked for less motion it is a still bar that shows
 * and hides. It is decoration for sighted people: the loaders it accompanies carry the status.
 */

/** How long a move has to be pending before the bar shows. */
export const PROGRESS_GRACE_MS = 90;
const TRICKLE_MS = 260;
/** How long the full bar stays before it has faded. */
const SETTLE_MS = 420;
/** A move that has not landed after this long is not going to; the bar stops saying it is. */
export const NAVIGATION_TIMEOUT_MS = 15_000;

type ProgressState = 'idle' | 'running' | 'done';

const IDLE_PROGRESS: { state: ProgressState; value: number } = { state: 'idle', value: 0 };

export function NavigationProgress(): ReactElement {
  const activity = useSyncExternalStore(
    subscribeActivity,
    activitySnapshot,
    serverActivitySnapshot,
  );
  useNavigationSignals(activity.navigation?.origin ?? null);
  const progress = useProgress(isBusy(activity));

  return (
    <div className="nav-progress" data-state={progress.state} aria-hidden="true">
      <span className="nav-progress-bar" style={{ transform: `scaleX(${progress.value})` }} />
    </div>
  );
}

/**
 * Starts a navigation when the router takes a click or a search form, and ends it when the
 * address leaves where it started, the person goes back or forward, or it takes too long.
 */
function useNavigationSignals(origin: string | null): void {
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (
        !event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        (anchor.target !== '' && anchor.target !== '_self') ||
        anchor.hasAttribute('download')
      ) {
        return;
      }
      beginNavigation(new URL(anchor.href), new URL(window.location.href));
    };

    const onSubmit = (event: SubmitEvent): void => {
      const form = event.target;
      if (
        !event.defaultPrevented ||
        !(form instanceof HTMLFormElement) ||
        form.method.toLowerCase() !== 'get'
      ) {
        return;
      }
      const target = new URL(form.action, window.location.href);
      const query = new URLSearchParams();
      for (const [name, value] of new FormData(form, event.submitter)) {
        if (typeof value === 'string') {
          query.append(name, value);
        }
      }
      target.search = query.toString();
      beginNavigation(target, new URL(window.location.href));
    };

    window.addEventListener('click', onClick);
    window.addEventListener('submit', onSubmit);
    window.addEventListener('popstate', endNavigation);
    return () => {
      window.removeEventListener('click', onClick);
      window.removeEventListener('submit', onSubmit);
      window.removeEventListener('popstate', endNavigation);
    };
  }, []);

  useEffect(() => {
    if (origin === null) {
      return undefined;
    }
    // The router moves the address when the new screen commits. Watching it frame by frame
    // costs nothing while nothing is pending, because nothing is watched then.
    let frame = 0;
    const watch = (): void => {
      if (addressOf(new URL(window.location.href)) !== origin) {
        endNavigation();
        return;
      }
      frame = window.requestAnimationFrame(watch);
    };
    frame = window.requestAnimationFrame(watch);
    const giveUp = window.setTimeout(endNavigation, NAVIGATION_TIMEOUT_MS);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(giveUp);
    };
  }, [origin]);
}

function useProgress(busy: boolean): { state: ProgressState; value: number } {
  const [progress, setProgress] = useState(IDLE_PROGRESS);
  const shown = useRef(false);

  useEffect(() => {
    if (busy) {
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const start = window.setTimeout(() => {
        shown.current = true;
        setProgress({ state: 'running', value: still ? 1 : 0.14 });
      }, PROGRESS_GRACE_MS);
      const trickle = still
        ? undefined
        : window.setInterval(() => {
            if (shown.current) {
              setProgress((current) => ({
                state: 'running',
                value: current.value + (0.94 - current.value) * 0.085,
              }));
            }
          }, TRICKLE_MS);
      return () => {
        window.clearTimeout(start);
        window.clearInterval(trickle);
      };
    }
    if (shown.current) {
      shown.current = false;
      setProgress({ state: 'done', value: 1 });
    }
    // Also settles a fill that a short-lived move interrupted before it had faded.
    const settle = window.setTimeout(
      () => setProgress((current) => (current.state === 'done' ? IDLE_PROGRESS : current)),
      SETTLE_MS,
    );
    return () => window.clearTimeout(settle);
  }, [busy]);

  return progress;
}
