/**
 * NX Trust: every screen the verification scripts visit.
 *
 * `portal` screens open with the development session of the console, `operator` screens with
 * the deployment token sent on this console's /operator requests only, and `anonymous` screens
 * with no session at all. `:customer` and `:subscriber` are resolved from the first row of
 * their lists, so the scripts need no fixture ids.
 */

export const ROUTES = [
  { name: 'portal-dashboard', path: '/dashboard', as: 'portal' },
  { name: 'portal-new-request', path: '/verifications/new', as: 'portal' },
  { name: 'portal-customers', path: '/customers', as: 'portal' },
  { name: 'portal-customer-file', path: '/customers/:customer', as: 'portal' },
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
  { name: 'operator-settings', path: '/operator/verification', as: 'operator' },
  { name: 'operator-integration', path: '/operator/verification/integration', as: 'operator' },
  { name: 'operator-endpoints', path: '/operator/verification/endpoints', as: 'operator' },
  { name: 'operator-health', path: '/operator/verification/health', as: 'operator' },
  { name: 'operator-readiness', path: '/operator/verification/readiness', as: 'operator' },
  { name: 'operator-reports', path: '/operator/reports', as: 'operator' },
  { name: 'operator-access', path: '/operator/access', as: 'operator' },
  { name: 'anonymous-operator-login', path: '/operator/login', as: 'anonymous' },
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
  if (token) {
    // Scoped to this console's panel, so the token never travels anywhere else the page loads from.
    for (const pattern of [`${base}/operator/**`, `${base}/operator`]) {
      await operator.route(pattern, (route) =>
        route.continue({ headers: { ...route.request().headers(), 'x-nx-operator-token': token } }),
      );
    }
  }
  return { portal, anonymous, operator };
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
    .replace(':subscriber', ids.subscriber ?? 'missing');
}
