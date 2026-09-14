#!/usr/bin/env node
/**
 * تصوير شاشات التطبيق بعرض 1440 لمقارنتها بصور المرجع في screens/.
 * التشغيل: node verify/shoot.mjs
 * أو مع عنوان مخصّص: BASE=http://localhost:5173 node verify/shoot.mjs
 *
 * عدّل قائمة ROUTES لتطابق مسارات مشروعك.
 *
 * NX Trust: the routes below are this console's (PLAN.md, section 4). Three additions to
 * the delivered script, all optional through the environment:
 *   PW_CHANNEL=chrome        use the installed Chrome instead of a downloaded Chromium
 *   NX_OPERATOR_TOKEN=...    open the administration panel as the deployment, by sending the
 *                            token in its header on this console's /operator requests only.
 *                            The console accepts that outside production alone (ADR-117);
 *                            staff in a deployment sign in with their own accounts
 *   CUSTOMER_ID=<uuid>       the customer file to shoot; otherwise the first one listed
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = "verify/output";

const ROUTES = [
  { file: "01-subscriber-dashboard", path: "/dashboard" },
  { file: "02-new-verification-request", path: "/verifications/new" },
  { file: "03-customer-profile", path: "/customers/:id" },
  { file: "04-customers-list", path: "/customers" },
  { file: "05-admin-pricing-settings", path: "/operator/pricing" },
  { file: "06-admin-subscribers-balances", path: "/operator/subscribers" }
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });

const token = process.env.NX_OPERATOR_TOKEN;
if (token) {
  // Scoped to this console's panel, so the token never travels with a request to anywhere
  // else the page loads from, fonts included.
  await context.route(`${BASE}/operator/**`, (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-nx-operator-token": token } })
  );
  await context.route(`${BASE}/operator`, (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-nx-operator-token": token } })
  );
}

const page = await context.newPage();

let customerId = process.env.CUSTOMER_ID;
if (!customerId) {
  await page.goto(BASE + "/customers", { waitUntil: "networkidle", timeout: 30000 }).catch(() => undefined);
  const href = await page
    .locator('a[href^="/customers/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")).find((h) => /^\/customers\/[0-9a-f-]{36}$/.test(h ?? "")))
    .catch(() => undefined);
  customerId = href ? href.split("/").pop() : undefined;
}

for (const r of ROUTES) {
  const url = BASE + r.path.replace(":id", customerId ?? "missing");
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${r.file}.png`, fullPage: true });
    console.log(`✓ ${r.file}  ←  ${url}`);
  } catch (e) {
    console.log(`✖ ${r.file}  ←  ${url}\n    ${e.message}`);
  }
}

await browser.close();

console.log(`
الصور في ${OUT}/ — قارن كل واحدة بنظيرتها في
design_handoff_verification_platform/screens/ واذكر الفروق في PROGRESS.md.
`);
