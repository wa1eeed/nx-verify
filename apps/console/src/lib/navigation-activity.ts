/**
 * What the console is waiting for, kept in one place (unit C4, ADR-120).
 *
 * Three things make a person wait: a move to another address that has not arrived yet, a
 * screen drawn as its loading shapes while its data is read, and a form whose action is still
 * running. Each reports here, and the progress bar, the data loader and the facts in the
 * sidebar all read the same answer, so they never disagree about whether the console is busy.
 *
 * Plain module state rather than a React context: the listeners that notice a navigation sit
 * on the window, outside any tree, and a loading screen and a submit button sit far apart in
 * it. React reads the state through useSyncExternalStore, which is what that hook is for.
 */

export interface PendingNavigation {
  /** The path and query the move is going to. */
  target: string;
  /** The path and query it left. The move has landed once the address is no longer this. */
  origin: string;
  /** The same screen with another query, such as the next page of a list. */
  sameScreen: boolean;
  startedAt: number;
}

export interface ActivitySnapshot {
  navigation: PendingNavigation | null;
  /** Loading screens on display. */
  loading: number;
  /** Form actions running. */
  actions: number;
  /**
   * Counts the navigations and actions ever started. A reader that refreshes something once
   * the console settles compares it with the last value it saw, so the settling after the
   * first page load, which nobody started, refreshes nothing.
   */
  generation: number;
}

export const IDLE: ActivitySnapshot = { navigation: null, loading: 0, actions: 0, generation: 0 };

let state: ActivitySnapshot = IDLE;
const listeners = new Set<() => void>();

function commit(next: ActivitySnapshot): void {
  state = next;
  for (const listener of [...listeners]) {
    listener();
  }
}

export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function activitySnapshot(): ActivitySnapshot {
  return state;
}

/** A page rendered on the server is waiting for nothing. */
export function serverActivitySnapshot(): ActivitySnapshot {
  return IDLE;
}

export function isBusy(snapshot: ActivitySnapshot): boolean {
  return snapshot.navigation !== null || snapshot.loading > 0 || snapshot.actions > 0;
}

/** The path and query of an address, which is what a navigation changes. */
export function addressOf(url: URL): string {
  return `${url.pathname}${url.search}`;
}

/**
 * A move somebody started, from one address to another.
 *
 * Nothing starts for a move to another site, which leaves the console, or for a move to the
 * address already open or to an anchor on it, which the router does not make anyone wait
 * for. The return says whether a navigation is now pending.
 */
export function beginNavigation(target: URL, current: URL, now: number = Date.now()): boolean {
  if (target.origin !== current.origin) {
    return false;
  }
  const to = addressOf(target);
  const from = addressOf(current);
  if (to === from) {
    return false;
  }
  commit({
    ...state,
    navigation: {
      target: to,
      origin: from,
      sameScreen: target.pathname === current.pathname,
      startedAt: now,
    },
    generation: state.generation + 1,
  });
  return true;
}

/** The move landed, was abandoned, or took too long to keep saying so. */
export function endNavigation(): void {
  if (state.navigation !== null) {
    commit({ ...state, navigation: null });
  }
}

/**
 * Something is on its way until the returned release is called.
 *
 * A loading screen holds while it is mounted, and a form action while it runs. An action also
 * counts as something started, because what it changed is what a reader waiting for the
 * console to settle wants to read again. The release is safe to call twice, as an effect's
 * cleanup can be.
 */
export function holdActivity(kind: 'loading' | 'action'): () => void {
  commit(
    kind === 'loading'
      ? { ...state, loading: state.loading + 1 }
      : { ...state, actions: state.actions + 1, generation: state.generation + 1 },
  );
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    commit(
      kind === 'loading'
        ? { ...state, loading: Math.max(0, state.loading - 1) }
        : { ...state, actions: Math.max(0, state.actions - 1) },
    );
  };
}

/** Tests start from a quiet console. */
export function resetActivity(): void {
  commit(IDLE);
}
