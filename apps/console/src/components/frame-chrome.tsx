'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Icon } from './ui/icon';

/**
 * The frame's furniture on every width (unit C6).
 *
 * On a wide screen the sidebar stands beside the content, as the handoff draws it. Below
 * 1024px, where a tablet held upright and every phone would squeeze the content into what the
 * sidebar leaves, the sidebar folds into a drawer: a bar along the top carries the brand and a
 * menu button, and the button slides the whole sidebar in from the start side, with the
 * places, the balance and the way out, over a dimmed screen.
 *
 * The drawer is a real modal while it is open: the content behind it is inert, Escape and a
 * press on the dimmed screen close it, and so does moving to another screen. Focus goes into
 * it on opening and back to the button on closing. On a wide screen none of this applies and
 * the bar is not drawn.
 */
export function FrameChrome({
  surface,
  brand,
  sidebarLabel,
  sidebar,
  children,
}: {
  surface: 'portal' | 'operator';
  /** The brand as the bar shows it. */
  brand: ReactNode;
  sidebarLabel: string;
  sidebar: ReactNode;
  children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const pathname = usePathname();

  // Moving to another screen closes the drawer: the screen is what was asked for.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const main = document.getElementById('main');
    if (!open) {
      main?.removeAttribute('inert');
      return undefined;
    }
    main?.setAttribute('inert', '');
    drawer.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      main?.removeAttribute('inert');
    };
  }, [open]);

  return (
    <div
      className="frame"
      data-surface={surface}
      data-menu={open ? 'open' : undefined}
    >
      <div className="frame-topbar" data-role="frame-topbar">
        {brand}
        <button
          ref={button}
          type="button"
          className="btn btn-ghost btn-icon frame-menu-button"
          aria-expanded={open}
          aria-controls={drawerId}
          aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name={open ? 'x' : 'menu'} size={17} />
        </button>
      </div>
      <aside ref={drawer} id={drawerId} className="frame-sidebar" aria-label={sidebarLabel}>
        {sidebar}
      </aside>
      <div
        className="frame-backdrop"
        aria-hidden="true"
        onClick={() => {
          setOpen(false);
          button.current?.focus();
        }}
      />
      {children}
    </div>
  );
}
