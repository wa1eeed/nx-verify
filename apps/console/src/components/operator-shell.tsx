import type { ReactElement, ReactNode } from 'react';
import { OPERATOR_ROLE_LABELS, type OperatorIdentity } from '@nx-verify/core';
import { Brand } from './brand';
import { FrameChrome } from './frame-chrome';
import { FrameMain } from './frame-main';
import { OPERATOR_SECTIONS } from './operator-nav';
import { SectionNav } from './section-nav';
import { Button } from './ui/button';

export {
  INTEGRATION_TABS,
  OPERATOR_SECTIONS,
  PRICING_TABS,
  SCREEN_LINKED_PAGES,
  SUBSCRIBER_TABS,
} from './operator-nav';

/**
 * The frame of the administration panel (handoff screens 05 and 06).
 *
 * Dark on purpose, so staff never mistake it for a subscriber's portal, and it shares
 * nothing with that portal except the component layer: not the session, not the
 * navigation, not the database role.
 *
 * Six places, each a question somebody running the platform asks: how is it going, who is
 * subscribed and what is left in their balance, what do we sell and for how much, how does
 * verification behave and is the data source connected, what did it earn, and who changed
 * what.
 */
export function OperatorShell({
  operator,
  children,
}: {
  /** Who is signed in: their name and their role, never their address. */
  operator: OperatorIdentity;
  children: ReactNode;
}): ReactElement {
  return (
    <>
      <a className="skip-link" href="#main">
        تخطَّ إلى المحتوى
      </a>

      <FrameChrome
        surface="operator"
        theme="dark"
        brand={<Brand href="/operator" suffix="أدمن" />}
        sidebarLabel="قائمة لوحة الإدارة"
        sidebar={
          <div className="frame-sidebar-inner">
            <Brand href="/operator" suffix="أدمن" />
            <SectionNav sections={OPERATOR_SECTIONS} label="أقسام لوحة الإدارة" />

            <div className="frame-sidebar-foot">
              <div className="frame-account">
                <span className="frame-account-name" data-role="operator-name">
                  {operator.displayName}
                  <span className="frame-account-role" data-role="operator-role">
                    {OPERATOR_ROLE_LABELS[operator.role]}
                  </span>
                </span>
                <form action="/operator/logout" method="post" className="inline">
                  <Button type="submit" variant="ghost" data-role="sign-out">
                    خروج
                  </Button>
                </form>
              </div>
            </div>
          </div>
        }
      >
        <FrameMain>{children}</FrameMain>
      </FrameChrome>
    </>
  );
}
