'use client';

import { useFormStatus } from 'react-dom';
import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { DataLoader, LOADER_WORDS, SLOW_AFTER_MS } from '../ui/data-loader';
import { useElapsed } from '../route-loading';

/**
 * A section of a customer file that verifies in place (the owner's ask, unit C5).
 *
 * Pressing a section's verify button starts the request and stays on the page: the section's
 * own body steps back under a loader that names it, and the rest of the file is untouched. When the section's check settles, the
 * new facts take their place, and the fields this verification wrote glow for a moment, so the
 * eye finds what arrived. The old values stay one click away on each field.
 *
 * The section is busy while its button's request is on its way or while the server says its
 * check is queued or running, whichever comes first, so a check started from elsewhere (the
 * whole-file refresh, another tab) shows the same loader.
 */

/**
 * What a section's verify button hears back: the request it started, or why it could not. The
 * time tells two answers apart.
 */
export interface SectionCheckState {
  status: 'idle' | 'started' | 'failed';
  error: 'checks' | 'iban' | 'failed' | null;
  at: number;
}

export type SectionCheckAction = (
  previous: SectionCheckState,
  formData: FormData,
) => Promise<SectionCheckState>;

const IDLE: SectionCheckState = { status: 'idle', error: null, at: 0 };

/** How long the fields a verification wrote stay lit. */
const GLOW_MS = 2600;
/** A request that never shows as running and never settles stops being waited for. */
const GIVE_UP_MS = 120_000;

const ERRORS: Readonly<Record<string, string>> = {
  iban: 'رقم الآيبان السعودي يبدأ بـSA ويتبعه 22 رقماً.',
  checks: 'حدّد عملية تحقق واحدة على الأقل.',
  failed: 'تعذّر بدء التحقق الآن. أعد المحاولة بعد قليل.',
};

interface Live {
  start: () => void;
  refreshed: () => void;
  fail: () => void;
}

const LiveContext = createContext<Live | null>(null);

export function SectionLive({
  titleAr,
  running,
  head,
  children,
  attributes,
}: {
  titleAr: string;
  /** The server says this section's check is queued or running. */
  running: boolean;
  head: ReactNode;
  children: ReactNode;
  attributes: Readonly<Record<`data-${string}`, string | undefined>>;
}): ReactElement {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const sawRunning = useRef(false);
  const body = useRef<HTMLDivElement>(null);
  const busy = running || startedAt !== null;
  const slow = useElapsed(SLOW_AFTER_MS, busy ? (startedAt ?? 'running') : null);

  const live = useMemo<Live>(
    () => ({
      start: () => {
        sawRunning.current = false;
        setRefreshed(false);
        setStartedAt(Date.now());
      },
      refreshed: () => setRefreshed(true),
      fail: () => setStartedAt(null),
    }),
    [],
  );

  useEffect(() => {
    if (startedAt === null) {
      return undefined;
    }
    if (running) {
      sawRunning.current = true;
      return undefined;
    }
    // Settled: it ran and stopped, or it finished before the file was asked for again.
    if (sawRunning.current || refreshed) {
      const since = startedAt;
      setStartedAt(null);
      glow(body.current, since);
      return undefined;
    }
    const giveUp = window.setTimeout(() => setStartedAt(null), GIVE_UP_MS);
    return () => window.clearTimeout(giveUp);
  }, [running, refreshed, startedAt]);

  return (
    <LiveContext.Provider value={live}>
      <div className="file-section" {...attributes} data-running={busy ? 'yes' : undefined}>
        {head}
        <div className="file-section-body" ref={body} aria-busy={busy ? true : undefined}>
          {children}
          {busy ? (
            <div className="file-section-loading">
              <DataLoader
                title={`نتحقق من ${titleAr}`}
                detail={slow ? LOADER_WORDS.slow : 'نطلب البيانات من الجهة الرسمية'}
              />
            </div>
          ) : null}
        </div>
      </div>
    </LiveContext.Provider>
  );
}

/** Lights, for a moment, the fields a verification that began at `since` wrote. */
function glow(root: HTMLElement | null, since: number): void {
  if (root === null) {
    return;
  }
  // The server's clock and this one differ by a little; a few seconds of slack covers it.
  const fresh = [...root.querySelectorAll<HTMLElement>('[data-observed]')].filter(
    (element) => Number(element.dataset['observed']) >= since - 5_000,
  );
  for (const element of fresh) {
    element.dataset['fresh'] = 'yes';
  }
  window.setTimeout(() => {
    for (const element of fresh) {
      delete element.dataset['fresh'];
    }
  }, GLOW_MS);
}

/**
 * The form behind a section's verify button, in place of a form that leaves the page.
 *
 * It tells the section the moment it is sent, hears when the request is running, and says why
 * when a request could not start, under the button rather than at the top of the file.
 */
export function SectionVerifyForm({
  action,
  id,
  children,
}: {
  action: SectionCheckAction;
  id?: string | undefined;
  children: ReactNode;
}): ReactElement {
  const live = useContext(LiveContext);
  const [state, formAction] = useActionState(action, IDLE);
  const handled = useRef(0);

  // The action's answer carries the file drawn again, so by the time it arrives the section
  // already knows whether its check is still running.
  useEffect(() => {
    if (state.at === handled.current) {
      return;
    }
    handled.current = state.at;
    if (state.status === 'started') {
      live?.refreshed();
    } else if (state.status === 'failed') {
      live?.fail();
    }
  }, [state, live]);

  return (
    <form action={formAction} className="file-section-form" data-role="section-form" id={id}>
      <StartWhenSent live={live} />
      {children}
      {state.status === 'failed' && state.error !== null ? (
        <p className="field-error file-section-error" role="alert">
          {ERRORS[state.error] ?? ERRORS['failed']}
        </p>
      ) : null}
    </form>
  );
}

/** Tells the section the moment its form is sent, before the server has answered anything. */
function StartWhenSent({ live }: { live: Live | null }): null {
  const { pending } = useFormStatus();
  useEffect(() => {
    if (pending) {
      live?.start();
    }
  }, [pending, live]);
  return null;
}
