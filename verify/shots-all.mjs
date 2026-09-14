#!/usr/bin/env node
/**
 * NX Trust: screenshots of every screen at desktop, tablet and phone widths.
 *
 *   BASE=http://localhost:3101 NX_OPERATOR_TOKEN=... node verify/shots-all.mjs <output-dir> [desktop,tablet,phone]
 *
 * Paired with compare-shots.mjs, it proves a change that should not move the design did not:
 * shoot before, change, shoot after, compare.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTES, WIDTHS, openContexts, pathOf, resolveIds } from './routes.mjs';

const BASE = process.env.BASE || 'http://localhost:3101';
const OUT = process.argv[2] || 'verify/output/all';
const sizes = (process.argv[3] || 'desktop,tablet,phone').split(',');

const browser = await chromium.launch(
  process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {},
);
let failures = 0;
for (const size of sizes) {
  const width = WIDTHS[size];
  mkdirSync(join(OUT, size), { recursive: true });
  const contexts = await openContexts(browser, {
    base: BASE,
    token: process.env.NX_OPERATOR_TOKEN,
    width,
  });
  const ids = await resolveIds(contexts, BASE);
  for (const route of ROUTES) {
    const page = await contexts[route.as].newPage();
    const url = BASE + pathOf(route, ids);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
      // Fonts and the last paint of a streamed page.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      await page.screenshot({
        path: join(OUT, size, `${route.name}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      console.log(`✓ ${size} ${route.name}`);
    } catch (error) {
      failures += 1;
      console.log(`✖ ${size} ${route.name} ← ${url}\n    ${error.message.split('\n')[0]}`);
    }
    await page.close();
  }
  await Promise.all(Object.values(contexts).map((context) => context.close()));
}
await browser.close();
process.exit(failures > 0 ? 1 : 0);
