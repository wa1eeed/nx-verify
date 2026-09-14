#!/usr/bin/env node
/**
 * تصوير شاشات التطبيق بعرض 1440 لمقارنتها بصور المرجع في screens/.
 * التشغيل: npx playwright install chromium && node verify/shoot.mjs
 * أو مع عنوان مخصّص: BASE=http://localhost:5173 node verify/shoot.mjs
 *
 * عدّل قائمة ROUTES لتطابق مسارات مشروعك.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = "verify/output";

const ROUTES = [
  { file: "01-subscriber-dashboard", path: "/" },
  { file: "02-new-verification-request", path: "/verify/new" },
  { file: "03-customer-profile", path: "/customers/1" },
  { file: "04-customers-list", path: "/customers" },
  { file: "05-admin-pricing-settings", path: "/admin/pricing" },
  { file: "06-admin-subscribers-balances", path: "/admin/subscribers" }
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });

for (const r of ROUTES) {
  const url = BASE + r.path;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
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
