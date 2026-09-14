import type { ReactElement } from 'react';
import type { InboxItem } from '@nx-verify/core';
import { EmptyState, PageHeader } from './page-header';

/**
 * The notification centre.
 *
 * One list, newest first, of the things a person has to act on or decide about. A
 * verification that completed normally is not here: it is not news, and an inbox that
 * announces routine success is an inbox people stop opening.
 *
 * Every row goes somewhere. A notification you cannot act on from is a notification that
 * makes somebody hunt through the app for the screen it meant.
 */

const KIND_LABELS: Record<InboxItem['kind'], string> = {
  change: 'تغيّر',
  review: 'مراجعة',
  overdue: 'متأخرة',
  balance: 'الرصيد',
  awaiting: 'بانتظار الجهة',
  share_opened: 'مشاركة',
};

const SEVERITY_STYLE: Record<InboxItem['severity'], { fg: string; bg: string; line: string }> = {
  info: { fg: 'var(--ink-soft)', bg: 'var(--paper-soft)', line: 'var(--line)' },
  warning: { fg: 'var(--changed-fg)', bg: 'var(--changed-bg)', line: 'var(--changed-line)' },
  critical: { fg: 'var(--critical-fg)', bg: 'var(--critical-bg)', line: 'var(--critical-line)' },
};

export function Inbox({
  items,
  seenAt,
}: {
  items: InboxItem[];
  /** Anything after this is marked new for this person. */
  seenAt: Date | null;
}): ReactElement {
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader title="الإشعارات" subtitle="ما يحتاج انتباهك، مرتّباً من الأحدث." />

      {items.length === 0 ? (
        <EmptyState>لا شيء ينتظرك. سنخبرك حين يتغيّر شيء أو تحتاج مراجعة قراراً.</EmptyState>
      ) : (
        <ul
          className="stack"
          data-role="inbox"
          style={{ gap: 'var(--s-3)', margin: 0, padding: 0 }}
        >
          {items.map((item) => {
            const unread = seenAt === null || item.at > seenAt;
            const style = SEVERITY_STYLE[item.severity];
            return (
              <li key={item.id} style={{ listStyle: 'none' }}>
                <a
                  className="card row"
                  href={item.href}
                  data-role="inbox-item"
                  data-kind={item.kind}
                  data-unread={unread ? 'yes' : 'no'}
                  style={{
                    gap: 'var(--s-4)',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    textDecoration: 'none',
                    color: 'inherit',
                    // Unread carries a solid edge on the start side rather than a dot: it
                    // survives printing and reads at a glance down a column.
                    borderInlineStartWidth: unread ? '4px' : '1px',
                    borderInlineStartColor: unread ? style.line : 'var(--line)',
                  }}
                >
                  <div className="stack" style={{ gap: '2px' }}>
                    <strong>{item.titleAr}</strong>
                    {item.detailAr ? <span className="faint">{item.detailAr}</span> : null}
                  </div>
                  <div className="row" style={{ gap: 'var(--s-3)' }}>
                    <span
                      className="badge"
                      style={{ color: style.fg, background: style.bg, borderColor: style.line }}
                    >
                      {KIND_LABELS[item.kind]}
                    </span>
                    <bdi dir="ltr" className="mono muted">
                      {item.at.toISOString().slice(0, 10)}
                    </bdi>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The bell, with the count of what arrived since this person last looked.
 *
 * A count and not a dot. "Something happened" makes a person open it to find out whether
 * it matters; a number lets them decide without leaving what they were doing.
 */
export function InboxBell({ unread }: { unread: number }): ReactElement {
  return (
    <a
      className="inbox-bell"
      href="/notifications"
      data-role="inbox-bell"
      data-unread={unread > 0 ? 'yes' : 'no'}
      aria-label={unread > 0 ? `الإشعارات، ${unread} جديدة` : 'الإشعارات'}
    >
      <span aria-hidden="true">الإشعارات</span>
      {unread > 0 ? (
        <span className="inbox-count" data-role="inbox-count">
          <bdi dir="ltr" className="mono">
            {unread > 99 ? '99+' : unread}
          </bdi>
        </span>
      ) : null}
    </a>
  );
}
