import { Suspense, type ReactElement, type ReactNode } from 'react';
import {
  OPERATOR_ROLE_LABELS,
  countPendingSandboxRequests,
  type OperatorIdentity,
} from '@nx-verify/core';
import { operatorQuery } from '../lib/operator';
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
  subscriberTabCounts,
} from './operator-nav';

/**
 * The panel's places, with the asks that are waiting counted beside the one they live under.
 *
 * The same count the portal draws beside «العملاء» for unread alerts (`Nav`), from the same
 * `SectionNav`, because a second way of saying «this needs you» is a second thing for a reader
 * to learn. What is counted here is asks for a sandbox: a subscriber's card says «وصلنا الطلب»
 * the moment they press, and until this number existed the only surface that knew was a tab
 * somebody had to think of opening.
 *
 * The word read aloud after it is «بالانتظار» rather than the portal's «جديد» (ADR-186). What
 * is behind this number is a queue, and a queue is not news: saying «المشتركون ٢ جديد» told a
 * member of staff that two things had just happened when two things had been sitting there
 * since last week.
 *
 * Zero shows nothing. A badge that is sometimes zero is a badge people stop reading.
 *
 * The number hangs on «المشتركون», which is the place the queue lives under, and pressing it
 * opens the list of subscribers rather than the queue. What continues the trail from there is
 * the same number on the «مساحات الاختبار» tab of that section, which is the surface that
 * actually answers it: one press to the section, one to the screen, and a number on each.
 */
function OperatorPlaces({ waiting = 0 }: { waiting?: number }): ReactElement {
  return (
    <SectionNav
      sections={OPERATOR_SECTIONS}
      label="أقسام لوحة الإدارة"
      counts={waiting > 0 ? { '/operator/subscribers': waiting } : {}}
      countLabel="بالانتظار"
    />
  );
}

/**
 * The same, having counted.
 *
 * Counted rather than listed (ADR-186). This read used to be `listPendingSandboxRequests`
 * measured with `.length`: every open ask on the platform, each carrying a subscriber's legal
 * name and workspace name, read on every render of every panel screen so that one digit could
 * be drawn. Rule 2 says a figure comes from a counter and not from raw rows, and it says so
 * for internal screens too. `countPendingSandboxRequests` is `count(*)` over the one predicate
 * the queue is defined by, which is the same definition of «waiting» the queue screen lists, so
 * the two cannot disagree while they read the same column.
 *
 * **A decorative number never takes a screen down.** This is read inside the layout, and a
 * layout's own throw is not caught by the `error.tsx` beside it: before this, a database that
 * stumbled on a badge threw every screen of the panel, including the ones that do not need a
 * database at all, onto the framework's default error page. So the failure is caught here and
 * the navigation renders without a number.
 *
 * What the screen then says is nothing, not zero, and the difference matters: no badge means
 * «no number to show», and the queue itself is never read through this. Somebody who opens
 * «مساحات الاختبار» reads the list from that screen's own query, which throws into that
 * screen's own error boundary and says plainly that it could not be read. The one thing we
 * lose when this fails is the bell, and the one thing we must not do is ring it wrong.
 */
async function OperatorPlacesWithWaiting(): Promise<ReactElement> {
  let waiting = 0;
  try {
    waiting = await operatorQuery((db) => countPendingSandboxRequests(db));
  } catch (error) {
    // The fact and its class, never the error itself: a connection failure can carry the
    // string it failed to connect with, and that string holds a password (rule 10).
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'the panel could not count the sandbox asks waiting',
        error: error instanceof Error ? error.name : 'unknown',
      }),
    );
  }
  return <OperatorPlaces waiting={waiting} />;
}

/**
 * The frame of the administration panel (handoff screens 05 and 06).
 *
 * Light, with a band across the top that names it (ADR-159).
 *
 * It was dark, on the reasoning that staff must never mistake it for a subscriber's portal.
 * The reasoning was right and the means were wrong: a dark theme is a second set of colours to
 * maintain for every component ever added, it read as a different product rather than the
 * other side of this one, and it was harder to read for long stretches, which is what the
 * people who live in this screen actually do. What separates the two surfaces now is a band
 * that says «لوحة المنصة» on every screen and cannot be scrolled away. A label somebody reads
 * beats a colour they stop noticing on the second day.
 *
 * It still shares nothing with the portal except the component layer: not the session, not the
 * navigation, not the database role.
 *
 * Six places, each a question somebody running the platform asks: how is it going, who is
 * subscribed and what is left in their balance, what do we sell and for how much, how does
 * verification behave and is the data source connected, what did it earn, and who changed
 * what.
 *
 * It reads one fact of its own, and only because the frame is the only surface every panel
 * screen shares: how many subscribers are waiting for an answer about a sandbox (ADR-180). A
 * screen that has to be opened to learn that something is waiting cannot tell anybody it is.
 *
 * The number is as fresh as the render that drew the frame, and no fresher. This layout is not
 * re-executed as somebody moves between panel screens, which is the same fact that makes every
 * screen check the sign in for itself: so the count is right for somebody opening the panel,
 * and it stands still for somebody who has been sitting in it since before the ask arrived.
 * Answering an ask revalidates the layout rather than only the page it was pressed on, which
 * is what keeps a stale number from outliving the ask it counted. Telling somebody who never
 * opens the panel is not this, and is not here yet.
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
        brand={<Brand href="/operator" suffix="أدمن" />}
        sidebarLabel="قائمة لوحة الإدارة"
        sidebar={
          <div className="frame-sidebar-inner">
            <Brand href="/operator" suffix="أدمن" />
            {/*
              The places, and the one number that has to reach somebody who did not come
              looking for it. Streamed, so a database that is slow to count never holds the
              navigation back: the places render at once, and the number joins them.
            */}
            <Suspense fallback={<OperatorPlaces />}>
              <OperatorPlacesWithWaiting />
            </Suspense>

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
        <FrameMain>
          {/*
            The marker that replaced the dark ground. Fixed at the head of the content, on
            every screen, saying which side of the platform this is and whose data is behind
            it: staff see every subscriber here, and forgetting that is the mistake the colour
            was there to prevent.
          */}
          <p className="operator-band" data-role="operator-band" role="status">
            لوحة المنصة · هذه ليست لوحة مشترك، وما يظهر هنا يخص جميع المشتركين
          </p>
          {children}
        </FrameMain>
      </FrameChrome>
    </>
  );
}
