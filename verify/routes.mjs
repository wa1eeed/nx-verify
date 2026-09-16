/* global URL, fetch -- node 20 provides both, and this file runs under node */
/**
 * NX Trust: every screen the verification scripts visit.
 *
 * `portal` screens open with the development session of the console, `operator` screens with
 * the deployment token sent on this console's /operator requests only, `door` screens with a
 * sign in held at its second step, and `anonymous` screens with no session at all. `:customer`
 * and `:subscriber` are resolved from the first row of their lists, so the scripts need no
 * fixture ids.
 *
 * A route may name an `expect` selector. It must be on the screen, which is how a route that
 * quietly redirects somewhere else fails loudly rather than passing as an empty page.
 */
import { createHmac } from 'node:crypto';

export const ROUTES = [
  { name: 'portal-dashboard', path: '/dashboard', as: 'portal' },
  { name: 'portal-new-request', path: '/verifications/new', as: 'portal' },
  { name: 'portal-customers', path: '/customers', as: 'portal' },
  { name: 'portal-customer-file', path: '/customers/:customer', as: 'portal' },
  { name: 'portal-parties', path: '/customers/parties', as: 'portal' },
  { name: 'portal-party-file', path: '/customers/:party', as: 'portal' },
  { name: 'portal-relations', path: '/customers/relations', as: 'portal' },
  { name: 'portal-alerts', path: '/customers/alerts', as: 'portal' },
  { name: 'portal-reviews', path: '/customers/reviews', as: 'portal' },
  { name: 'portal-verifications', path: '/verifications', as: 'portal' },
  { name: 'portal-failed', path: '/verifications/failed', as: 'portal' },
  { name: 'portal-onboarding', path: '/verifications/onboarding', as: 'portal' },
  { name: 'portal-billing', path: '/billing', as: 'portal' },
  { name: 'portal-invoices', path: '/billing/invoices', as: 'portal' },
  { name: 'portal-prices', path: '/billing/prices', as: 'portal' },
  { name: 'portal-settings-users', path: '/settings', as: 'portal' },
  { name: 'portal-notifications', path: '/settings/notifications', as: 'portal' },
  { name: 'portal-developers', path: '/settings/developers', as: 'portal' },
  { name: 'portal-api-logs', path: '/settings/developers/logs', as: 'portal' },
  { name: 'portal-api-reference', path: '/settings/developers/reference', as: 'portal' },
  { name: 'portal-sandbox', path: '/settings/developers/sandbox', as: 'portal' },
  { name: 'portal-freshness', path: '/settings/freshness', as: 'portal' },
  { name: 'portal-portfolios', path: '/settings/portfolios', as: 'portal' },
  { name: 'portal-rules', path: '/settings/rules', as: 'portal' },
  { name: 'portal-support', path: '/settings/support', as: 'portal' },
  { name: 'operator-overview', path: '/operator', as: 'operator' },
  { name: 'operator-subscribers', path: '/operator/subscribers', as: 'operator' },
  { name: 'operator-subscriber', path: '/operator/subscribers/:subscriber', as: 'operator' },
  { name: 'operator-topups', path: '/operator/subscribers/topups', as: 'operator' },
  { name: 'operator-pricing', path: '/operator/pricing', as: 'operator' },
  { name: 'operator-plans', path: '/operator/pricing/plans', as: 'operator' },
  { name: 'operator-modules', path: '/operator/pricing/modules', as: 'operator' },
  { name: 'operator-settings', path: '/operator/verification', as: 'operator' },
  { name: 'operator-integration', path: '/operator/verification/integration', as: 'operator' },
  { name: 'operator-routing', path: '/operator/verification/routing', as: 'operator' },
  { name: 'operator-risk', path: '/operator/verification/risk', as: 'operator' },
  { name: 'operator-mail', path: '/operator/verification/mail', as: 'operator' },
  { name: 'operator-endpoints', path: '/operator/verification/endpoints', as: 'operator' },
  { name: 'operator-health', path: '/operator/verification/health', as: 'operator' },
  { name: 'operator-readiness', path: '/operator/verification/readiness', as: 'operator' },
  { name: 'operator-reports', path: '/operator/reports', as: 'operator' },
  { name: 'operator-access', path: '/operator/access', as: 'operator' },
  {
    name: 'anonymous-operator-login',
    path: '/operator/login',
    as: 'anonymous',
    expect: '[data-role="operator-sign-in"]',
  },
  {
    name: 'door-operator-code',
    path: '/operator/login/code',
    as: 'door',
    expect: '[data-role="operator-second-factor"]',
  },
];

export const WIDTHS = { desktop: 1440, tablet: 820, phone: 390 };

/** A browser context for each kind of visitor, and the ids the dynamic paths need. */
export async function openContexts(browser, { base, token, width }) {
  const viewport = { width, height: width < 768 ? 844 : 1000 };
  const options = {
    viewport,
    deviceScaleFactor: 1,
    ...(width < 768 ? { isMobile: true, hasTouch: true } : {}),
  };
  const portal = await browser.newContext(options);
  const anonymous = await browser.newContext(options);
  const operator = await browser.newContext(options);
  const door = await browser.newContext(options);
  if (token) {
    // Scoped to this console's panel, so the token never travels anywhere else the page loads from.
    for (const pattern of [`${base}/operator/**`, `${base}/operator`]) {
      await operator.route(pattern, (route) =>
        route.continue({ headers: { ...route.request().headers(), 'x-nx-operator-token': token } }),
      );
    }
    await mintDoorCookie(door, { base, token });
  }
  return { portal, anonymous, operator, door };
}

/**
 * A sign in held between the password and the code, so the second step is a screen the scripts
 * can open. The value is the one apps/console/src/lib/operator.ts writes, minted here rather
 * than fetched because no screen hands it out; a change to that format shows up as the door
 * route failing its `expect`.
 *
 * It is minted again just before that route is visited rather than once at the start of a
 * sweep. The console caps this window at ten minutes (SEC-02) and it is right to: a half
 * finished sign in left open all afternoon is the thing the second step exists to prevent. A
 * sweep of forty screens takes longer than that, so minting once made a correct rule look like
 * a broken screen.
 */
export async function mintDoorCookie(door, { base, token }) {
  if (!token) {
    return;
  }
  const account = await accountIdOf(base, token);
  if (!account) {
    return;
  }
  const expires = Date.now() + 9 * 60_000;
  const mac = createHmac('sha256', token)
    .update(`nx-operator-pending/v1|${account}|enrol|${expires}`)
    .digest('base64url');
  await door.addCookies([
    {
      name: 'nx_operator_pending',
      value: `p1.${account}.enrol.${expires}.${mac}`,
      domain: new URL(base).hostname,
      path: '/operator',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
}

/** The first member of staff, read from the panel's own screen rather than the database. */
async function accountIdOf(base, token) {
  const response = await fetch(`${base}/operator/access`, {
    headers: { 'x-nx-operator-token': token },
  });
  const html = await response.text();
  return /data-staff-id="([0-9a-f-]{36})"/.exec(html)?.[1] ?? null;
}

export async function resolveIds(contexts, base) {
  const ids = {};
  const portal = await contexts.portal.newPage();
  await portal.goto(`${base}/customers`, { waitUntil: 'networkidle', timeout: 120000 });
  const customer = await portal
    .locator('a[href^="/customers/"]')
    .evaluateAll((links) =>
      links
        .map((link) => link.getAttribute('href'))
        .find((href) => /^\/customers\/[0-9a-f-]{36}$/.test(href ?? '')),
    );
  ids.customer = customer?.split('/').pop();
  // A related party's file, from the first row of their list.
  await portal.goto(`${base}/customers/parties`, { waitUntil: 'networkidle', timeout: 120000 });
  const party = await portal
    .locator('tr[data-role="party-row"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-party')).find(Boolean));
  ids.party = party ?? undefined;
  await portal.close();
  const operator = await contexts.operator.newPage();
  await operator.goto(`${base}/operator/subscribers`, {
    waitUntil: 'networkidle',
    timeout: 120000,
  });
  const subscriber = await operator
    .locator('a[href^="/operator/subscribers/"]')
    .evaluateAll((links) =>
      links
        .map((link) => link.getAttribute('href'))
        .find((href) => /\/operator\/subscribers\/[0-9a-f-]{36}$/.test(href ?? '')),
    );
  ids.subscriber = subscriber?.split('/').pop();
  await operator.close();
  return ids;
}

export function pathOf(route, ids) {
  return route.path
    .replace(':customer', ids.customer ?? 'missing')
    .replace(':party', ids.party ?? 'missing')
    .replace(':subscriber', ids.subscriber ?? 'missing');
}
