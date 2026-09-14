'use client';

import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Icon } from '../ui/icon';
import { Ltr } from '../ui/ltr';
import type { HistoryStretch } from './field-history-model';

/**
 * The values a field has held, as a short story rather than a log (the owner's ask).
 *
 * Verifying a fact again usually finds it unchanged, and a list of eleven identical rows says
 * less than one line that says «the same since 12 September, verified 11 times». So the past is
 * told in stretches: each value once, with the first and last time it was seen, how many
 * verifications saw it, and where it changed into the next. The current value leads.
 *
 * It opens beside the field rather than inside the grid, so a long history never stretches the
 * other fields of its row, and it closes with Escape or a click anywhere else.
 */

export function FieldHistory({
  label,
  stretches,
  current,
}: {
  label: string;
  stretches: readonly HistoryStretch[];
  /** The current value as the field draws it. */
  current: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const verifications = stretches.reduce((sum, stretch) => sum + stretch.count, 0);
  const values = stretches.length;

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const close = (event: MouseEvent | KeyboardEvent): void => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !root.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div
      className="file-history"
      ref={root}
      data-role="field-history"
      data-open={open ? '' : undefined}
    >
      <button
        type="button"
        className="file-history-toggle"
        data-changed={values > 1 ? '' : undefined}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="clock" size={14} />
        السجل ·{' '}
        {values > 1 ? (
          <>
            تغيّرت <Ltr>{values - 1}</Ltr>
          </>
        ) : (
          'ثابتة'
        )}
      </button>
      {open ? (
        <div className="file-history-panel" id={panelId} role="region" aria-label={`سجل ${label}`}>
          <p className="file-history-summary">
            <Ltr>{verifications}</Ltr> {verifications === 1 ? 'تحقق' : 'تحققات'} ·{' '}
            <Ltr>{values}</Ltr> {values === 1 ? 'قيمة' : 'قيم'}
          </p>
          <ol className="file-history-list">
            {stretches.map((stretch, index) => (
              <li
                key={`${stretch.to}-${index}`}
                className="file-history-item"
                data-current={stretch.current ? 'yes' : undefined}
                data-changed={stretch.current ? undefined : 'yes'}
              >
                <span className="file-history-dot" aria-hidden="true" />
                <span className="file-history-value">
                  {stretch.current ? current : stretch.valueAr}
                  {stretch.current ? <span className="file-history-now">الحالية</span> : null}
                </span>
                <span className="file-history-meta">
                  {stretch.from === stretch.to ? (
                    <Ltr>{stretch.from}</Ltr>
                  ) : (
                    <>
                      من <Ltr>{stretch.from}</Ltr> إلى <Ltr>{stretch.to}</Ltr>
                    </>
                  )}
                  {' · '}
                  <Ltr>{stretch.count}</Ltr> {stretch.count === 1 ? 'تحقق' : 'تحققات'}
                  {stretch.authority ? ` · ${stretch.authority}` : ''}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
