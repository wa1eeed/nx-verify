#!/usr/bin/env node
/* global document, window, location, getComputedStyle, MutationObserver -- read inside page.evaluate, which runs in the browser */
/**
 * NX Trust: moving between screens, proven in a browser against the running console (unit C4).
 *
 *   BASE=http://localhost:3101 NX_OPERATOR_TOKEN=... node verify/check-navigation.mjs [shots-dir]
 *
 * Every answer from the server for a move is held back for a moment, so what a person sees while
 * waiting can be looked at: the bar along the top, the screen fading back under the data loader,
 * the loader's words. Then it checks the move landed without reloading the page, that the
 * sidebar read its facts again, that a file link downloads rather than moves, and that a person
 * who asked for less motion gets a loader standing still. Exits 1 on any failure.
 *
 * Opening the open alerts marks them seen for the development user, as it would for anyone.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openContexts } from './routes.mjs';

const BASE = process.env.BASE || 'http://localhost:3101';
const SHOTS = process.argv[2] || null;
const HOLD_MS = 1500;

const browser = await chromium.launch(
  process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {},
);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✖'} ${name}${detail ? ` · ${detail}` : ''}`);
};
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};

/** Holds back every answer to a move, then lets the next handler (the panel's token) send it. */
async function holdMoves(context) {
  await context.route('**/*', async (route) => {
    if (route.request().headers()['rsc'] === '1') {
      await sleep(HOLD_MS);
    }
    await route.fallback();
  });
}

const loaderText = (page, scope) =>
  page.evaluate((selector) => {
    const loader = document.querySelector(`${selector} [data-role="data-loader"]`);
    return loader
      ? {
          title: loader.querySelector('.data-loader-title')?.textContent ?? '',
          detail: loader.querySelector('.data-loader-detail')?.textContent ?? '',
        }
      : null;
  }, scope);

const settled = (page) =>
  page.waitForFunction(
    () =>
      document.querySelector('.nav-progress')?.getAttribute('data-state') === 'idle' &&
      !document.querySelector('main[data-pending]') &&
      !document.querySelector('[data-role="loading"]'),
    null,
    { timeout: 60000 },
  );

const errors = [];
const watchConsole = (page) => {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const where = message.location()?.url;
      errors.push(where ? `${message.text()} (${where})` : message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
};

const contexts = await openContexts(browser, {
  base: BASE,
  token: process.env.NX_OPERATOR_TOKEN,
  width: 1440,
});

// ── the portal ────────────────────────────────────────────────────────────
{
  const page = await contexts.portal.newPage();
  watchConsole(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.evaluate(() => {
    window.__nxStayed = true;
  });
  await holdMoves(contexts.portal);

  // A place in the sidebar.
  await page.click('nav.frame-nav a[href="/customers"]');
  await page.waitForTimeout(450);
  const bar = await page.getAttribute('.nav-progress', 'data-state');
  const pending = await page.$('main[data-pending][aria-busy="true"]');
  const words = await loaderText(page, '.loader-float');
  await shot(page, 'pending-place');
  check('the bar runs while a move is on its way', bar === 'running', `state ${bar}`);
  check('the screen fades back under the loader', pending !== null);
  check(
    'the loader names the screen on its way',
    words?.title === 'قائمة العملاء' && words?.detail === 'نجلب أحدث البيانات',
    JSON.stringify(words),
  );
  await page.waitForURL(`${BASE}/customers`, { timeout: 60000 });
  await settled(page);
  check(
    'the move lands without reloading the page',
    await page.evaluate(() => window.__nxStayed === true),
  );

  // A slow network: the next screen's shapes show under the same loader, which never blinks.
  const cdp = await contexts.portal.newCDPSession(page);
  await cdp.send('Network.enable');
  await page.click('nav.frame-nav a[href="/dashboard"]');
  await page.waitForURL(`${BASE}/dashboard`, { timeout: 60000 });
  await settled(page);
  await page.evaluate(() => {
    // Counts the loader appearing. One move, one loader: a second appearance is a blink.
    window.__nxLoaderShown = 0;
    let present = Boolean(document.querySelector('.loader-float'));
    new MutationObserver(() => {
      const now = Boolean(document.querySelector('.loader-float'));
      if (!present && now) window.__nxLoaderShown += 1;
      present = now;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 300,
    downloadThroughput: Math.round((16 * 1024) / 8),
    uploadThroughput: 64 * 1024,
  });
  await page.click('nav.frame-nav a[href="/customers"]');
  const shapes = await page
    .waitForFunction(
      () => {
        const loading = document.querySelector('[data-role="loading"]');
        const title = document.querySelector('.loader-float .data-loader-title')?.textContent;
        return loading ? { shape: loading.getAttribute('data-shape'), title } : false;
      },
      null,
      { timeout: 30000, polling: 50 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  await shot(page, 'loading-list');
  check(
    'the next screen shows its own shapes, named by the same loader',
    shapes?.shape === 'list' && shapes?.title === 'قائمة العملاء',
    JSON.stringify(shapes),
  );
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await page.waitForURL(`${BASE}/customers`, { timeout: 60000 });
  await settled(page);
  check(
    'the loader stays put from the click until the screen is ready',
    (await page.evaluate(() => window.__nxLoaderShown)) === 1,
    `shown ${await page.evaluate(() => window.__nxLoaderShown)} times`,
  );

  // A row of a list.
  await page.click('tbody.linked-rows tr[data-href] td:first-child');
  await page.waitForTimeout(450);
  const rowWords = await loaderText(page, '.loader-float');
  check(
    'a row opens its file through the router',
    rowWords?.title === 'ملف العميل',
    JSON.stringify(rowWords),
  );
  await page.waitForURL(/\/customers\/[0-9a-f-]{36}$/, { timeout: 60000 });
  await settled(page);
  check(
    'the file opens without reloading the page',
    await page.evaluate(() => window.__nxStayed === true),
  );

  // The next page of a list: the same screen, refreshed.
  await page.click('nav.frame-nav a[href="/verifications"]');
  await page.waitForURL(`${BASE}/verifications`, { timeout: 60000 });
  await settled(page);
  const next = await page.$('a[aria-label="الصفحة 2"]');
  if (next === null) {
    check('the next page of a list refreshes in place', false, 'fewer than 26 operations to page');
  } else {
    await next.click();
    await page.waitForTimeout(450);
    const refresh = await loaderText(page, '.loader-float');
    await shot(page, 'pending-refresh');
    check(
      'the next page of a list refreshes in place',
      refresh?.title === 'سجل العمليات' && refresh?.detail === 'نحدّث النتائج',
      JSON.stringify(refresh),
    );
    await page.waitForURL(`${BASE}/verifications?page=2`, { timeout: 60000 });
    await settled(page);
  }

  // The sidebar's facts, read again after a move.
  const facts = page.waitForResponse((response) => response.url() === `${BASE}/frame-facts`, {
    timeout: 60000,
  });
  await page.click('nav.frame-nav a[href="/customers"]');
  await page.waitForURL(`${BASE}/customers`, { timeout: 60000 });
  await page.click('nav[data-role="section-tabs"] a[href="/customers/alerts"]');
  await page.waitForURL(`${BASE}/customers/alerts`, { timeout: 60000 });
  await settled(page);
  const answer = await facts.catch(() => null);
  const body = answer ? await answer.json().catch(() => null) : null;
  check(
    'the sidebar reads its facts again once the move settles',
    body !== null && Number.isInteger(body.unread),
    body === null ? 'no answer' : `unread ${body.unread}`,
  );
  await page
    .waitForFunction(() => !document.querySelector('[data-role="nav-count"]'), null, {
      timeout: 5000,
    })
    .catch(() => null);
  check(
    'opening the alerts clears their count in the sidebar without a reload',
    (await page.$('[data-role="nav-count"]')) === null &&
      (await page.evaluate(() => window.__nxStayed === true)),
  );

  // A file is downloaded, not moved to.
  await page.click('nav.frame-nav a[href="/dashboard"]');
  await page.waitForURL(`${BASE}/dashboard`, { timeout: 60000 });
  await settled(page);
  let fetchedAhead = false;
  page.on('request', (request) => {
    if (request.url().startsWith(`${BASE}/dashboard/report?`)) fetchedAhead = true;
  });
  const download = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
  await page.click('[data-role="export-report"]');
  const file = await download;
  check(
    'the report link downloads the file, and the router never fetches it',
    file !== null && !fetchedAhead,
    file ? file.suggestedFilename() : 'no download',
  );
  await page.close();
}

// ── less motion ───────────────────────────────────────────────────────────
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  watchConsole(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 120000 });
  await holdMoves(context);
  await page.click('nav.frame-nav a[href="/billing"]');
  await page.waitForSelector('.loader-float .data-loader-bar', { timeout: 5000 }).catch(() => null);
  const still = await page.evaluate(() =>
    [...document.querySelectorAll('.data-loader-bar')].map(
      (bar) => getComputedStyle(bar).animationName,
    ),
  );
  check(
    'a person who asked for less motion gets the loader standing still',
    still.length > 0 && still.every((name) => name === 'none'),
    still.join(','),
  );
  await page.waitForURL(`${BASE}/billing`, { timeout: 60000 });
  await context.close();
}

// ── the panel ─────────────────────────────────────────────────────────────
if (process.env.NX_OPERATOR_TOKEN) {
  const page = await contexts.operator.newPage();
  watchConsole(page);
  await page.goto(`${BASE}/operator`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.evaluate(() => {
    window.__nxStayed = true;
  });
  await holdMoves(contexts.operator);
  await page.click('nav.frame-nav a[href="/operator/subscribers"]');
  await page.waitForTimeout(450);
  const words = await loaderText(page, '.loader-float');
  await shot(page, 'pending-panel');
  check(
    'the panel names the screen on its way',
    words?.title === 'المشتركون والأرصدة',
    JSON.stringify(words),
  );
  await page.waitForURL(`${BASE}/operator/subscribers`, { timeout: 60000 });
  await settled(page);
  check(
    'the panel moves without reloading the page',
    await page.evaluate(
      () => window.__nxStayed === true && location.pathname === '/operator/subscribers',
    ),
  );
  await page.close();
} else {
  console.log('· the panel skipped: NX_OPERATOR_TOKEN is not set');
}

const unexpected = errors.filter((text) => !/Download the React DevTools/.test(text));
check('no error reached the console', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
