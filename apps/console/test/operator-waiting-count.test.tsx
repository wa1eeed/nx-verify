import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { withTenant } from '../../../packages/db/src/client';
import type { OperatorIdentity } from '../../../packages/core/src/operators/accounts';
import {
  countPendingSandboxRequests,
  refuseSandboxRequest,
  requestSandbox,
} from '../../../packages/core/src/tenants/sandbox';
import { createTestDatabase, seedTenant, type TestDatabase } from '../../../test/helpers/db';
import {
  OperatorShell,
  SUBSCRIBER_TABS,
  subscriberTabCounts,
} from '../src/components/operator-shell';
import { SectionTabs } from '../src/components/section-tabs';
import { closeOperatorPool } from '../src/lib/operator';

/**
 * ADR-180: an ask for a sandbox reaches somebody. ADR-186: without costing what it cost.
 *
 * The loop ADR-173 built had no bell. The subscriber's card said «وصلنا الطلب» the moment they
 * pressed, and the only surface that knew was a tab a member of staff had to think of opening,
 * so an ask could sit for a month under a sentence saying it had arrived. What is asserted here
 * is the bell: the frame every panel screen sits in counts the asks that are waiting, beside
 * the place they live under, and says nothing at all when none are.
 *
 * And what ADR-186 asserts about that bell: that it is a count and not a list measured with
 * `.length`, that the number leads to the screen that answers it, that a number nobody asked
 * for cannot take the panel down when the database stumbles on it, and that what a screen
 * reader hears is «بالانتظار» rather than the portal's «جديد», because a queue is not news.
 *
 * Rendered with the streaming renderer rather than `renderToStaticMarkup`, because the count is
 * read from the database inside the frame: the sync renderer would hand back the fallback and
 * the test would assert the markup of a nav that never counted anything.
 */

const STAFF: OperatorIdentity = {
  id: '33333333-3333-4333-8333-333333333333',
  displayName: 'موظف الدعم',
  role: 'SUPPORT',
};

/** A database that is not there. Port 1 refuses at once rather than hanging on a timeout. */
const UNREACHABLE = 'postgres://nx_operator:notapassword@127.0.0.1:1/nx_nowhere';

/** The frame, rendered all the way: nothing is left suspended when this resolves. */
async function renderFrame(element: ReactElement): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done): void {
        chunks.push(Buffer.from(chunk));
        done();
      },
    });
    sink.on('finish', () => resolve(Buffer.concat(chunks).toString('utf8')));
    sink.on('error', reject);

    const { pipe } = renderToPipeableStream(element, {
      onAllReady() {
        pipe(sink);
      },
      onError(error: unknown) {
        reject(error);
      },
    });
  });
}

/** The markup of one link, by the address it leads to: a place in the sidebar, or a tab. */
function linkTo(html: string, href: string): string {
  const link = html
    .split('<a ')
    .find((part) => part.startsWith(`href="${href}"`) || part.includes(`href="${href}"`));
  return link === undefined ? '' : link.slice(0, link.indexOf('</a>'));
}

describe('the panel says how many asks are waiting', () => {
  let db: TestDatabase;
  let asks: string[] = [];
  /**
   * What the variable held before this file took it. Every suite in a worker shares one
   * environment, so a file that sets a connection string and walks away leaves the next one
   * pointed at a container that has been torn down.
   */
  let previousOperatorUrl: string | undefined;

  beforeAll(async () => {
    db = await createTestDatabase();
    previousOperatorUrl = process.env['NX_OPERATOR_DATABASE_URL'];
    process.env['NX_OPERATOR_DATABASE_URL'] = db.operatorConnectionString;

    const first = await seedTenant(db.appPool, 'شركة تنتظر');
    const second = await seedTenant(db.appPool, 'شركة تنتظر أيضاً');
    asks = [];
    for (const tenant of [first, second]) {
      const asked = await withTenant(db.appPool, tenant.tenantId, (tx) => requestSandbox(tx));
      asks.push(asked.id);
    }
  });

  afterAll(async () => {
    await closeOperatorPool();
    await db.close();
    if (previousOperatorUrl === undefined) {
      delete process.env['NX_OPERATOR_DATABASE_URL'];
    } else {
      process.env['NX_OPERATOR_DATABASE_URL'] = previousOperatorUrl;
    }
  });

  it('counts them beside the place they live under, on every screen of the panel', async () => {
    const html = await renderFrame(<OperatorShell operator={STAFF}>{null}</OperatorShell>);

    // The same pill the portal draws beside «العملاء» for unread alerts, from the same
    // component: one way of saying «this needs you», not a second one for staff to learn.
    expect(html).toContain('data-role="nav-count"');
    const subscribers = linkTo(html, '/operator/subscribers');
    expect(subscribers).toContain('المشتركون');
    expect(subscribers).toContain('data-role="nav-count"');
    expect(subscribers).toContain('>2<');

    // What a screen reader hears after the number. «جديد» is the portal's word for an alert
    // that arrived; these two have been waiting since somebody pressed a button last week.
    expect(subscribers).toContain('بالانتظار');
    expect(subscribers).not.toContain('جديد');

    // And it is on the frame, so it reaches somebody who opened the panel for another reason
    // entirely. The band that names this surface is drawn by the same component.
    expect(html).toContain('data-role="operator-band"');
    // No other place claims a number it was not given.
    expect(linkTo(html, '/operator/pricing')).not.toContain('data-role="nav-count"');

    // A digit, and nothing about who is behind it: no subscriber's name reaches the frame of
    // a screen that was not asking about subscribers (rule 2).
    expect(html).not.toContain('شركة تنتظر');
  });

  it('counts rather than lists, and counts only what is open', async () => {
    // The frame used to call `listPendingSandboxRequests` and take `.length`: every open ask
    // across every subscriber, each carrying a legal name and a workspace name, read on every
    // render of every panel screen so that one digit could be drawn (rule 2, ADR-186).
    const shell = readFileSync(
      fileURLToPath(new URL('../src/components/operator-shell.tsx', import.meta.url)),
      'utf8',
    );
    // Without its prose, which names the old call in order to say why it is gone.
    const code = shell.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).toContain('countPendingSandboxRequests');
    expect(code).not.toContain('listPendingSandboxRequests');

    // And the counter counts the queue, not the table: an ask that was answered is not waiting.
    const answered = await seedTenant(db.appPool, 'شركة قُرّر لها');
    const asked = await withTenant(db.appPool, answered.tenantId, (tx) => requestSandbox(tx));
    await refuseSandboxRequest(db.operatorPool, STAFF, {
      requestId: asked.id,
      code: 'NOT_ELIGIBLE',
    });

    expect(await countPendingSandboxRequests(db.operatorPool)).toBe(2);
  });

  it('draws the same number on the tab that answers it', () => {
    // The sidebar hangs the count on «المشتركون», and pressing it opens the subscribers and
    // their balances, where no ask appears. The trail continues on the tab that lists them.
    const html = renderToStaticMarkup(
      <SectionTabs
        tabs={SUBSCRIBER_TABS}
        current="/operator/subscribers"
        label="أقسام المشتركين"
        counts={subscriberTabCounts(2)}
      />,
    );

    const queue = linkTo(html, '/operator/subscribers/sandboxes');
    expect(queue).toContain('مساحات الاختبار');
    expect(queue).toContain('data-role="tab-count"');
    expect(queue).toContain('>2<');
    expect(queue).toContain('بالانتظار');

    // Only that tab. The section's other screens answer a different question.
    expect(linkTo(html, '/operator/subscribers/topups')).not.toContain('data-role="tab-count"');
    // And nothing at all when the queue is empty: a badge that is sometimes zero stops being
    // read.
    expect(
      renderToStaticMarkup(
        <SectionTabs
          tabs={SUBSCRIBER_TABS}
          current="/operator/subscribers"
          label="أقسام المشتركين"
          counts={subscriberTabCounts(0)}
        />,
      ),
    ).not.toContain('data-role="tab-count"');
  });

  it('draws the panel without a number when the number cannot be read', async () => {
    // The count is read inside the layout, and a layout's own throw is not caught by the
    // `error.tsx` beside it. Before ADR-186 a database that stumbled on a decorative badge
    // threw every screen of the panel, including the ones that need no database at all, onto
    // the framework's default error page.
    const logged: string[] = [];
    const recorder = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]): void => {
      logged.push(args.map((arg) => String(arg)).join(' '));
    });

    await closeOperatorPool();
    process.env['NX_OPERATOR_DATABASE_URL'] = UNREACHABLE;

    let html: string;
    try {
      html = await renderFrame(<OperatorShell operator={STAFF}>{null}</OperatorShell>);
    } finally {
      recorder.mockRestore();
      await closeOperatorPool();
      process.env['NX_OPERATOR_DATABASE_URL'] = db.operatorConnectionString;
    }

    // The panel is there: its places, its band, and the person signed in.
    expect(linkTo(html, '/operator/subscribers')).toContain('المشتركون');
    expect(html).toContain('data-role="operator-band"');
    expect(html).toContain('موظف الدعم');
    // And no badge, which is «no number to show» rather than «nothing is waiting»: the screen
    // that lists the queue reads it for itself and has a boundary that says so plainly.
    expect(html).not.toContain('data-role="nav-count"');

    // Recorded rather than swallowed, and without the string it failed to connect with: a
    // connection error can carry one, and that string holds a password (rule 10).
    const failures = logged.filter((line) => line.includes('sandbox asks'));
    expect(failures).toHaveLength(1);
    expect(failures[0]).not.toContain('notapassword');
    expect(failures[0]).not.toContain('nx_nowhere');
  });

  it('says nothing once the queue is empty', async () => {
    for (const requestId of asks) {
      await refuseSandboxRequest(db.operatorPool, STAFF, { requestId, code: 'NOT_ELIGIBLE' });
    }

    const html = await renderFrame(<OperatorShell operator={STAFF}>{null}</OperatorShell>);

    // A badge that is sometimes zero is a badge people stop reading, so zero draws nothing.
    expect(html).not.toContain('data-role="nav-count"');
    expect(linkTo(html, '/operator/subscribers')).toContain('المشتركون');
  });
});
