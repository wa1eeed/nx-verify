#!/usr/bin/env node
/* global document -- read inside page.evaluate, which runs in the browser */
/**
 * NX Trust: every screen fits the phone and the tablet.
 *
 *   BASE=http://localhost:3101 NX_OPERATOR_TOKEN=... node verify/check-responsive.mjs
 *
 * Fails when a screen scrolls sideways or draws nothing in its main area at 390 or 820 pixels
 * wide. A table may scroll inside its own container; the page itself may not.
 */
import { chromium } from 'playwright';
import { ROUTES, WIDTHS, openContexts, pathOf, resolveIds } from './routes.mjs';

const BASE = process.env.BASE || 'http://localhost:3101';
const browser = await chromium.launch(
  process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {},
);
let failures = 0;
for (const size of ['tablet', 'phone']) {
  const contexts = await openContexts(browser, {
    base: BASE,
    token: process.env.NX_OPERATOR_TOKEN,
    width: WIDTHS[size],
  });
  const ids = await resolveIds(contexts, BASE);
  for (const route of ROUTES) {
    const page = await contexts[route.as].newPage();
    try {
      await page.goto(BASE + pathOf(route, ids), { waitUntil: 'networkidle', timeout: 120000 });
      // Measured against the device width, not window.innerWidth: a phone widens its layout
      // viewport to fit content that is too wide, so innerWidth grows with the very overflow
      // this looks for, and a page 863 pixels wide on a 390 pixel phone reports no overflow.
      const facts = await page.evaluate((deviceWidth) => {
        const main = document.querySelector('main');
        const width = main ? main.getBoundingClientRect().width : 0;
        return {
          overflow: document.documentElement.scrollWidth - deviceWidth,
          mainVisible: width > 0 && width <= deviceWidth,
        };
      }, WIDTHS[size]);
      const ok = facts.overflow <= 0 && facts.mainVisible;
      if (!ok) {
        failures += 1;
      }
      console.log(
        `${ok ? '✓' : '✖'} ${size} ${route.name}: overflow ${facts.overflow}px, main ${facts.mainVisible ? 'visible' : 'off screen'}`,
      );
    } catch (error) {
      failures += 1;
      console.log(`✖ ${size} ${route.name}: ${error.message.split('\n')[0]}`);
    }
    await page.close();
  }
  await Promise.all(Object.values(contexts).map((context) => context.close()));
}
await browser.close();
process.exit(failures > 0 ? 1 : 0);
