import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activitySnapshot,
  beginNavigation,
  endNavigation,
  holdActivity,
  isBusy,
  resetActivity,
  subscribeActivity,
} from '../src/lib/navigation-activity';
import {
  FALLBACK_SUBJECT,
  loadingShapeOf,
  loadingSubjectOf,
} from '../src/components/loading-screen';
import { LoadingState } from '../src/components/states';
import { RouteLoading } from '../src/components/route-loading';
import { FrameMain } from '../src/components/frame-main';
import { NavigationProgress } from '../src/components/navigation-progress';
import { frameFactsOf } from '../src/components/frame-facts';
import { DataLoader, LOADER_WORDS } from '../src/components/ui/data-loader';
import { ButtonLink } from '../src/components/ui/button';

/**
 * The interface unit, step C4: moving between screens, and saying what is on its way.
 *
 * What a browser does with these is proven in verify/check-navigation.mjs against the running
 * console. Here: the state every indicator reads, the names the loader gives, the shapes a
 * loading screen draws, and the rules the source has to keep for moves to stay in the page.
 */

const here = dirname(fileURLToPath(import.meta.url));
const consoleRoot = join(here, '..');
const url = (path: string): URL => new URL(path, 'https://console.example');

function walk(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path, found);
    } else {
      found.push(path);
    }
  }
  return found;
}

describe('what the console is waiting for', () => {
  afterEach(() => resetActivity());

  it('starts a move between two addresses of the console, and nothing else', () => {
    expect(beginNavigation(url('https://elsewhere.example/'), url('/customers'))).toBe(false);
    expect(beginNavigation(url('/customers'), url('/customers'))).toBe(false);
    expect(beginNavigation(url('/customers#risk'), url('/customers'))).toBe(false);
    expect(isBusy(activitySnapshot())).toBe(false);

    expect(beginNavigation(url('/customers?page=2'), url('/customers'), 1_000)).toBe(true);
    expect(activitySnapshot().navigation).toEqual({
      target: '/customers?page=2',
      origin: '/customers',
      sameScreen: true,
      startedAt: 1_000,
    });
    expect(beginNavigation(url('/billing'), url('/customers'))).toBe(true);
    expect(activitySnapshot().navigation?.sameScreen).toBe(false);
    expect(isBusy(activitySnapshot())).toBe(true);

    endNavigation();
    expect(isBusy(activitySnapshot())).toBe(false);
  });

  it('holds while a loading screen or an action is under way, and a release counts once', () => {
    const loading = holdActivity('loading');
    const action = holdActivity('action');
    expect(activitySnapshot()).toMatchObject({ loading: 1, actions: 1 });
    loading();
    loading();
    expect(activitySnapshot()).toMatchObject({ loading: 0, actions: 1 });
    expect(isBusy(activitySnapshot())).toBe(true);
    action();
    expect(isBusy(activitySnapshot())).toBe(false);
  });

  it('counts what was started, so the settling after a first load refreshes nothing', () => {
    const release = holdActivity('loading');
    release();
    expect(activitySnapshot().generation).toBe(0);
    beginNavigation(url('/billing'), url('/dashboard'));
    endNavigation();
    holdActivity('action')();
    expect(activitySnapshot().generation).toBe(2);
  });

  it('tells its readers when it changes, until they leave', () => {
    let calls = 0;
    const leave = subscribeActivity(() => {
      calls += 1;
    });
    beginNavigation(url('/billing'), url('/dashboard'));
    endNavigation();
    leave();
    beginNavigation(url('/customers'), url('/dashboard'));
    expect(calls).toBe(2);
  });
});

describe('the name the loader gives a screen', () => {
  it('reads the navigation, so a tab and its loader say the same words', () => {
    expect(loadingSubjectOf('/customers')).toBe('قائمة العملاء');
    expect(loadingSubjectOf('/customers/alerts')).toBe('التنبيهات المفتوحة');
    expect(loadingSubjectOf('/verifications')).toBe('سجل العمليات');
    expect(loadingSubjectOf('/dashboard')).toBe('اللوحة الرئيسية');
    expect(loadingSubjectOf('/settings/developers/logs')).toBe('سجل النداءات');
    expect(loadingSubjectOf('/operator')).toBe('نظرة عامة');
    expect(loadingSubjectOf('/operator/subscribers/topups')).toBe('الحوالات');
    expect(loadingSubjectOf('/operator/reports')).toBe('التقارير');
  });

  it('names a screen opened from a row by its kind, and anything else by its place', () => {
    expect(loadingSubjectOf('/customers/6b7f4a0e-2d4c-4f5e-9a1b-0c3d2e1f4a5b')).toBe('ملف العميل');
    expect(loadingSubjectOf('/verifications/onboarding/abc')).toBe('ملف التأهيل');
    expect(loadingSubjectOf('/operator/subscribers/abc')).toBe('ملف المشترك');
    expect(loadingSubjectOf('/operator/pricing/plans')).toBe('الباقات');
    expect(loadingSubjectOf('/billing/somewhere-new')).toBe('الاشتراك والرصيد');
    expect(loadingSubjectOf('/operator/access/')).toBe('الصلاحيات والتدقيق');
    expect(loadingSubjectOf('/nowhere')).toBe(FALLBACK_SUBJECT);
  });

  it('draws each screen in the shape it will arrive in, whichever loading boundary shows', () => {
    expect(loadingShapeOf('/dashboard')).toBe('overview');
    expect(loadingShapeOf('/billing')).toBe('overview');
    expect(loadingShapeOf('/operator')).toBe('overview');
    expect(loadingShapeOf('/operator/reports')).toBe('overview');
    expect(loadingShapeOf('/customers')).toBe('list');
    expect(loadingShapeOf('/customers/alerts')).toBe('list');
    expect(loadingShapeOf('/operator/subscribers/topups')).toBe('list');
    expect(loadingShapeOf('/customers/6b7f4a0e-2d4c-4f5e-9a1b-0c3d2e1f4a5b')).toBe('file');
    expect(loadingShapeOf('/verifications/onboarding/abc')).toBe('file');
    expect(loadingShapeOf('/operator/subscribers/abc')).toBe('file');
    expect(loadingShapeOf('/verifications/new')).toBe('form');
    expect(loadingShapeOf('/operator/verification/')).toBe('form');
    expect(loadingShapeOf('')).toBe('list');
  });
});

describe('a screen on its way', () => {
  const shape = (html: string): string => /data-shape="([a-z]+)"/.exec(html)?.[1] ?? '';

  it('draws the shapes of the screen that is coming', () => {
    const overview = renderToStaticMarkup(<LoadingState />);
    expect(shape(overview)).toBe('overview');
    expect(overview.match(/skeleton-stat/g)).toHaveLength(4);
    expect(overview).not.toContain('skeleton-line');

    const list = renderToStaticMarkup(<LoadingState shape="list" />);
    expect(list).toContain('skeleton-tabs');
    expect(list.match(/class="skeleton-line"/g)).toHaveLength(7);

    const file = renderToStaticMarkup(<LoadingState shape="file" />);
    expect(file).toContain('skeleton-head');
    expect(file).toContain('skeleton-sections');

    const form = renderToStaticMarkup(<LoadingState shape="form" />);
    expect(form.match(/class="skeleton-line"/g)).toHaveLength(4);
  });

  it('is busy for assistive technology, and leaves the words to the frame when inside one', () => {
    const bare = renderToStaticMarkup(<LoadingState />);
    expect(bare).toContain('aria-busy="true"');
    expect(bare).toMatch(/class="visually-hidden" role="status">جارٍ التحميل/);

    const quiet = renderToStaticMarkup(<LoadingState shape="list" announce={false} />);
    expect(quiet).toContain('aria-busy="true"');
    expect(quiet).not.toContain('role="status"');
  });

  it('draws the loader as a chart for the eye and words for everyone', () => {
    const html = renderToStaticMarkup(
      <DataLoader title="سجل العمليات" detail={LOADER_WORDS.refreshing} />,
    );
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toMatch(/class="data-loader-chart" aria-hidden="true"/);
    expect(html.match(/class="data-loader-bar"/g)).toHaveLength(4);
    expect(html).toContain('<span class="data-loader-title">سجل العمليات</span>');
    expect(html).toContain('نحدّث النتائج');
  });

  it('draws a list when the address is not known yet, as on the server, and says nothing itself', () => {
    const html = renderToStaticMarkup(<RouteLoading />);
    expect(html).toContain('data-shape="list"');
    expect(html).not.toContain('role="status"');
  });

  it('keeps the frame and the bar quiet while nothing is on its way', () => {
    const main = renderToStaticMarkup(<FrameMain>{null}</FrameMain>);
    expect(main).toBe('<main class="frame-main" id="main"></main>');
    const bar = renderToStaticMarkup(<NavigationProgress />);
    expect(bar).toContain('class="nav-progress" data-state="idle" aria-hidden="true"');
  });

  it('writes no em dash in anything it says', () => {
    for (const words of Object.values(LOADER_WORDS)) {
      expect(words).not.toContain(String.fromCharCode(0x2014));
    }
  });
});

describe('every place has a loading screen', () => {
  const appRoot = join(consoleRoot, 'src', 'app');

  it('is the route loader, once per frame, so no inner boundary shows a second set of shapes', () => {
    // A loading file inside a place would show the frame's shapes first and its own after
    // them. The shape comes from the address instead, whichever boundary shows.
    const loaders = walk(appRoot)
      .filter((path) => path.endsWith('loading.tsx'))
      .map((path) => relative(appRoot, dirname(path)));
    expect(loaders.sort()).toEqual(['(app)', join('operator', '(panel)')].sort());
    for (const dir of loaders) {
      expect(readFileSync(join(appRoot, dir, 'loading.tsx'), 'utf8')).toContain('<RouteLoading />');
    }
  });

  it('covers every screen of the portal and the panel from its own folder or one above', () => {
    const pages = walk(appRoot)
      .filter((path) => path.endsWith('page.tsx'))
      .map((path) => dirname(path))
      .filter((dir) => /\(app\)|operator[\\/]\(panel\)/.test(dir));
    const uncovered = pages.filter((dir) => {
      for (let at = dir; at.startsWith(appRoot) && at !== appRoot; at = dirname(at)) {
        if (readdirSync(at).includes('loading.tsx')) return false;
      }
      return true;
    });
    expect(uncovered.map((dir) => relative(appRoot, dir))).toEqual([]);
  });
});

describe('moves stay inside the page', () => {
  it('links to screens through the router, keeping plain anchors for files and anchors', () => {
    // A plain anchor to a screen reloads the whole page: the frame redraws, the loader never
    // shows, and the facts of the sidebar are read twice.
    const offenders: string[] = [];
    for (const path of walk(join(consoleRoot, 'src'))) {
      if (!/\.tsx$/.test(path)) continue;
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(
        /<a\s[^>]*?href=(?:"\/|\{`\/|\{href\(|\{item\.)[^>]*>/g,
      )) {
        if (!/\sdownload[\s>=]/.test(match[0])) {
          offenders.push(`${relative(consoleRoot, path)}: ${match[0].slice(0, 60)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('fetches a file with a plain link the router neither takes nor fetches ahead', () => {
    const html = renderToStaticMarkup(
      <ButtonLink href="/dashboard/report" download icon="download">
        تصدير التقرير
      </ButtonLink>,
    );
    expect(html).toMatch(/^<a href="\/dashboard\/report" download="" class="btn btn-secondary">/);
  });

  it('sends a member of staff whose sign in ended to the sign in page from every panel screen', () => {
    // A move inside the panel does not render its layout again, so the layout's check alone
    // would let the move reach a screen that throws instead.
    const panel = join(consoleRoot, 'src', 'app', 'operator', '(panel)');
    const pages = walk(panel).filter((path) => path.endsWith('page.tsx'));
    expect(pages.length).toBeGreaterThanOrEqual(10);
    for (const path of pages) {
      expect(readFileSync(path, 'utf8'), relative(panel, path)).toContain(
        'await operatorOrSignIn()',
      );
    }
  });
});

describe('the facts of the sidebar, as the browser reads them back', () => {
  it('accepts a count and a balance of either kind', () => {
    expect(frameFactsOf({ unread: 3, balance: null })).toEqual({ unread: 3, balance: null });
    expect(
      frameFactsOf({ unread: 0, balance: { kind: 'operations', remaining: 10, included: 30 } }),
    ).toEqual({ unread: 0, balance: { kind: 'operations', remaining: 10, included: 30 } });
    expect(frameFactsOf({ unread: 1, balance: { kind: 'wallet', availableHalalas: 500 } })).toEqual(
      { unread: 1, balance: { kind: 'wallet', availableHalalas: 500 } },
    );
  });

  it('refuses anything else rather than drawing it', () => {
    expect(frameFactsOf(null)).toBeNull();
    expect(frameFactsOf('<!doctype html>')).toBeNull();
    expect(frameFactsOf({ unread: -1, balance: null })).toBeNull();
    expect(frameFactsOf({ unread: 1.5, balance: null })).toBeNull();
    expect(frameFactsOf({ unread: 1 })).toBeNull();
    expect(frameFactsOf({ unread: 1, balance: { kind: 'wallet' } })).toBeNull();
    expect(frameFactsOf({ unread: 1, balance: { kind: 'card', availableHalalas: 5 } })).toBeNull();
  });
});
