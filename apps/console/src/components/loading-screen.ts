import { isInSection } from './section-nav';
import {
  BILLING_TABS,
  CUSTOMER_TABS,
  DEVELOPER_TABS,
  SECTIONS,
  SETTINGS_TABS,
  VERIFICATION_TABS,
} from './nav';
import { INTEGRATION_TABS, OPERATOR_SECTIONS, SUBSCRIBER_TABS } from './operator-nav';
import type { LoadingShape } from './states';

/**
 * What a screen on its way is called and what it looks like, read from its path (unit C4).
 *
 * The address has moved by the time a loading screen is up, so the path is the screen being
 * fetched, whichever loading boundary shows. That is why neither the name nor the shape is
 * written into a loading file: the frame's one loading screen asks here, and the shapes and
 * the words cannot disagree with the screen that arrives.
 *
 * The names are the ones the navigation already shows, read from the same lists, so the loader
 * says «قائمة العملاء» because the tab says it, and a tab renamed tomorrow is renamed here too.
 * A screen reached from a list rather than from the navigation is named by its kind, and a path
 * nothing names falls back to the place it sits in, then to the data.
 */

const TABS = [
  CUSTOMER_TABS,
  VERIFICATION_TABS,
  BILLING_TABS,
  SETTINGS_TABS,
  DEVELOPER_TABS,
  SUBSCRIBER_TABS,
  INTEGRATION_TABS,
].flat();

const PLACES = [...SECTIONS, ...OPERATOR_SECTIONS];

/** Screens opened from a row of a list, which the navigation does not name. */
const DETAIL_SCREENS: readonly { pattern: RegExp; subject: string }[] = [
  { pattern: /^\/customers\/[^/]+$/, subject: 'ملف العميل' },
  { pattern: /^\/verifications\/onboarding\/[^/]+$/, subject: 'ملف التأهيل' },
  { pattern: /^\/operator\/subscribers\/[^/]+$/, subject: 'ملف المشترك' },
];

const NAMED_SCREENS: Readonly<Record<string, string>> = {
  '/operator/pricing/plans': 'الباقات',
};

/** Screens of figures and panels rather than one long list. */
const OVERVIEWS = new Set(['/dashboard', '/billing', '/operator', '/operator/reports']);

/** Screens that are mostly fields to fill. */
const FORMS = new Set([
  '/verifications/new',
  '/settings/notifications',
  '/settings/rules',
  '/settings/freshness',
  '/settings/support',
  '/settings/developers/sandbox',
  '/settings/developers/reference',
  '/operator/verification',
  '/operator/verification/integration',
  '/operator/verification/endpoints',
  '/operator/verification/readiness',
]);

export const FALLBACK_SUBJECT = 'البيانات';

function normalise(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function loadingSubjectOf(pathname: string): string {
  const path = normalise(pathname);
  const tab = TABS.find((entry) => entry.href === path);
  if (tab !== undefined) {
    return tab.label;
  }
  const place = PLACES.find((entry) => entry.href === path);
  if (place !== undefined) {
    return place.label;
  }
  const named = NAMED_SCREENS[path];
  if (named !== undefined) {
    return named;
  }
  const detail = DETAIL_SCREENS.find((entry) => entry.pattern.test(path));
  if (detail !== undefined) {
    return detail.subject;
  }
  // The longest place that holds the path, so /operator/... is not named after /operator.
  const holder = PLACES.filter((entry) => !entry.exact && isInSection(path, entry)).sort(
    (left, right) => right.href.length - left.href.length,
  )[0];
  return holder?.label ?? FALLBACK_SUBJECT;
}

export function loadingShapeOf(pathname: string): LoadingShape {
  const path = normalise(pathname);
  if (TABS.some((entry) => entry.href === path) || NAMED_SCREENS[path] !== undefined) {
    return FORMS.has(path) ? 'form' : OVERVIEWS.has(path) ? 'overview' : 'list';
  }
  if (DETAIL_SCREENS.some((entry) => entry.pattern.test(path))) {
    return 'file';
  }
  if (OVERVIEWS.has(path)) {
    return 'overview';
  }
  return FORMS.has(path) ? 'form' : 'list';
}
