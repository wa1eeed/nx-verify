'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { Capability } from '@nx-verify/core';
import {
  activitySnapshot,
  isBusy,
  serverActivitySnapshot,
  subscribeActivity,
} from '../lib/navigation-activity';
import { BalanceCard, type BalanceView } from './balance-card';
import { Nav } from './nav';

/**
 * The sidebar's live facts: the unread alerts and the balance (unit C4).
 *
 * A move inside the console renders the new screen and leaves the frame alone, so the facts the
 * layout read for the first page would otherwise stay as they were. Each time the console
 * settles after a move or a form action, and when the tab comes back into view, the sidebar
 * reads them again from /frame-facts. Opening the alerts clears their count, and a run paid for
 * on one screen shows in the balance on the next.
 */

export interface FrameFacts {
  unread: number;
  balance: BalanceView | null;
}

export const FRAME_FACTS_PATH = '/frame-facts';

/** A settle shorter than this is treated as part of the same wait. */
const SETTLE_MS = 150;
/** A tab that comes back into view reads again at most this often. */
const VISIBLE_REFRESH_MS = 30_000;

const FactsContext = createContext<FrameFacts>({ unread: 0, balance: null });

export function FrameFactsProvider({
  initial,
  children,
}: {
  initial: FrameFacts;
  children: ReactNode;
}): ReactElement {
  const [facts, setFacts] = useState(initial);
  const activity = useSyncExternalStore(
    subscribeActivity,
    activitySnapshot,
    serverActivitySnapshot,
  );
  const busy = isBusy(activity);
  const readFor = useRef(activity.generation);
  const lastRead = useRef(0);
  const latest = useRef(0);

  // The layout rendered again, from a refresh: its facts are the newest.
  const initialKey = JSON.stringify(initial);
  const firstKey = useRef(initialKey);
  useEffect(() => {
    if (initialKey !== firstKey.current) {
      firstKey.current = initialKey;
      setFacts(JSON.parse(initialKey) as FrameFacts);
    }
  }, [initialKey]);

  useEffect(() => {
    const refresh = async (): Promise<void> => {
      const request = ++latest.current;
      lastRead.current = Date.now();
      const next = await fetchFrameFacts();
      if (next !== null && request === latest.current) {
        setFacts(next);
      }
    };

    if (!busy && activity.generation !== readFor.current) {
      const generation = activity.generation;
      const timer = window.setTimeout(() => {
        readFor.current = generation;
        void refresh();
      }, SETTLE_MS);
      return () => window.clearTimeout(timer);
    }

    const onVisible = (): void => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastRead.current > VISIBLE_REFRESH_MS
      ) {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [busy, activity.generation]);

  return <FactsContext.Provider value={facts}>{children}</FactsContext.Provider>;
}

/** The places, with the unread count on the customers. */
export function LiveNav({ capabilities }: { capabilities: readonly Capability[] }): ReactElement {
  return <Nav alerts={useContext(FactsContext).unread} capabilities={new Set(capabilities)} />;
}

/** What is left to spend, at the foot of the sidebar. */
export function LiveBalance(): ReactElement | null {
  const { balance } = useContext(FactsContext);
  return balance === null ? null : <BalanceCard balance={balance} />;
}

/**
 * The facts, or nothing when they cannot be read: a session that ended answers with a redirect
 * to the sign in page, and the next screen the person opens takes them there.
 */
export async function fetchFrameFacts(): Promise<FrameFacts | null> {
  try {
    const response = await fetch(FRAME_FACTS_PATH, {
      cache: 'no-store',
      redirect: 'manual',
      headers: { accept: 'application/json' },
    });
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) {
      return null;
    }
    return frameFactsOf(await response.json());
  } catch {
    return null;
  }
}

/** Facts from a response, checked rather than trusted. */
export function frameFactsOf(value: unknown): FrameFacts | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { unread, balance } = value as { unread?: unknown; balance?: unknown };
  if (typeof unread !== 'number' || !Number.isInteger(unread) || unread < 0) {
    return null;
  }
  if (balance === null) {
    return { unread, balance: null };
  }
  if (typeof balance !== 'object') {
    return null;
  }
  const view = balance as Partial<Record<string, unknown>>;
  if (
    view['kind'] === 'operations' &&
    typeof view['remaining'] === 'number' &&
    typeof view['included'] === 'number'
  ) {
    return {
      unread,
      balance: { kind: 'operations', remaining: view['remaining'], included: view['included'] },
    };
  }
  if (view['kind'] === 'wallet' && typeof view['availableHalalas'] === 'number') {
    return { unread, balance: { kind: 'wallet', availableHalalas: view['availableHalalas'] } };
  }
  return null;
}
