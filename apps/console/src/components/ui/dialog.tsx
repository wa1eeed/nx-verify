'use client';

import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { IconButton } from './button';

/**
 * A modal (`.dialog` over `.dialog-backdrop`), built on the native dialog element.
 *
 * The element brings what hand-built modals get wrong: focus moves in and stays in, Escape
 * closes it, the page behind is inert, and it sits above everything else. The dialog element
 * is itself the backdrop, so a press outside the card closes it as well. Focus inside is the
 * sheet's `:focus-visible` ring.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
}: {
  open: boolean;
  /** Called on Escape, on a press outside the card, and when a form inside closes it. */
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog-backdrop"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) {
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="dialog">
        <div className="dialog-head">
          <h2 className="dialog-title" id={titleId}>
            {title}
          </h2>
          <IconButton icon="x" label="إغلاق" onClick={onClose} data-role="dialog-close" />
        </div>
        <div className="dialog-body">{children}</div>
        {actions === undefined || actions === null ? null : (
          <div className="dialog-actions">{actions}</div>
        )}
      </div>
    </dialog>
  );
}
