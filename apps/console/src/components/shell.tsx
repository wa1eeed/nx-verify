import type { ReactElement, ReactNode } from 'react';
import { BalanceCard, type BalanceView } from './balance-card';
import { Brand } from './brand';
import { Nav } from './nav';
import { Button } from './ui/button';
import { Icon } from './ui/icon';

/**
 * The frame every subscriber screen sits in (README, shared frame template).
 *
 * Presentation only, and that is deliberate: the layout above it reads which workspace this
 * is and what is left in its balance, and this renders it. Keeping the queries out means the
 * frame can be rendered and asserted without a database.
 *
 * The rounded frame on the canvas, the sidebar on the start side with the brand, the places
 * and the balance at its foot, and the content beside it. A skip link comes first, because
 * a keyboard should not have to walk the navigation on every screen.
 *
 * The sandbox note cannot be closed. A person who forgets which world they are in draws
 * conclusions from test data, and the sandbox exists because its data proves nothing.
 */
export function Shell({
  isSandbox,
  unread = 0,
  balance = null,
  children,
}: {
  isSandbox: boolean;
  /** How many alerts arrived since this person last looked. */
  unread?: number;
  balance?: BalanceView | null;
  children: ReactNode;
}): ReactElement {
  return (
    <>
      <a className="skip-link" href="#main">
        تخطَّ إلى المحتوى
      </a>

      <div className="frame" data-surface="portal">
        <aside className="frame-sidebar">
          <div className="frame-sidebar-inner">
            <Brand href="/dashboard" />
            <Nav alerts={unread} />

            <div className="frame-sidebar-foot">
              {balance === null ? null : <BalanceCard balance={balance} />}
              <div className="frame-account">
                <span data-role="environment-name">
                  {isSandbox ? 'بيئة الاختبار' : 'بيئة الإنتاج'}
                </span>
                <form action="/logout" method="post" className="inline">
                  <Button type="submit" variant="ghost" data-role="sign-out">
                    خروج
                  </Button>
                </form>
              </div>
            </div>
          </div>
        </aside>

        <main className="frame-main" id="main">
          {isSandbox ? (
            <p className="sandbox-note" data-role="sandbox-banner" role="status">
              <Icon name="info" size={15} />
              بيئة اختبار. البيانات هنا تجريبية ولا تثبت شيئاً، والمستندات المختومة فيها موسومة.
            </p>
          ) : null}
          {children}
        </main>
      </div>
    </>
  );
}
