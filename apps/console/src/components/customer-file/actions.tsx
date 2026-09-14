'use client';

import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import type { IconName } from '../ui/icon';

/**
 * The file's header actions that need the browser: printing it, and the two dialogs.
 *
 * What the dialogs hold is drawn on the server and handed in, so the forms inside them post
 * to the same server actions as everywhere else.
 */

/** «تصدير الملف»: the browser's print, which the print sheet turns into the evidence alone. */
export function ExportFileButton(): ReactElement {
  return (
    <Button icon="download" onClick={() => window.print()} data-role="export-file">
      تصدير الملف
    </Button>
  );
}

export function DialogButton({
  label,
  title,
  icon,
  variant = 'secondary',
  initiallyOpen = false,
  role,
  children,
}: {
  label: string;
  title: string;
  icon?: IconName | undefined;
  variant?: 'primary' | 'secondary' | undefined;
  /** Open on arrival, as the share dialog is right after a link was issued. */
  initiallyOpen?: boolean | undefined;
  role?: string | undefined;
  children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <Button variant={variant} icon={icon} onClick={() => setOpen(true)} data-role={role}>
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        {children}
      </Dialog>
    </>
  );
}

const WATCH_MS = 2000;

/**
 * Keeps a file current while its checks run in the background.
 *
 * Asks which of the customer's checks are still queued or running, and redraws the file the
 * moment that changes, so a section fills as soon as its own check settles rather than when
 * the last one does (README, interactions). Draws nothing, and stops when nothing is running.
 */
export function FileWatcher({
  entityId,
  running,
  watch,
}: {
  entityId: string;
  running: readonly string[];
  watch: (entityId: string) => Promise<string[]>;
}): null {
  const router = useRouter();
  const key = [...running].sort().join(',');

  useEffect(() => {
    if (key === '') {
      return undefined;
    }
    let stopped = false;
    const timer = setInterval(() => {
      watch(entityId)
        .then((now) => {
          if (!stopped && [...now].sort().join(',') !== key) {
            stopped = true;
            router.refresh();
          }
        })
        .catch(() => undefined);
    }, WATCH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [entityId, key, router, watch]);

  return null;
}
