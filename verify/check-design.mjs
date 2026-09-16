#!/usr/bin/env node
/**
 * فحص التزام الكود بنظام Organic.
 * التشغيل: node verify/check-design.mjs
 * يخرج بكود 1 عند وجود أي مخالفة.
 *
 * يفحص كل ملفات src/ ما عدا ملف التوكنات نفسه.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = "src";
const TOKENS = ["src/styles/organic.css", "src/styles/organic.scss"];
const EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte", ".css", ".scss"]);

// One face, served by us (ADR-125, ADR-139). Caprasimo and Figtree belong to the Organic
// sheet and are neither loaded nor named in a stack any more, so naming one now is a
// third party contacted for a face nobody reads.
const ALLOWED_FONTS = ["IBM Plex Sans Arabic"];
const BANNED_FONTS = ["Inter", "Roboto", "Arial", "Helvetica", "Poppins", "Montserrat", "Cairo", "Tajawal"];

if (!existsSync(ROOT)) {
  console.error(`لم يُعثر على المجلد ${ROOT}/`);
  process.exit(1);
}

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (EXT.has(extname(name))) files.push(p);
  }
})(ROOT);

const problems = [];
const add = (file, line, rule, text) => problems.push({ file, line, rule, text: text.trim().slice(0, 120) });

let interactiveFiles = 0;
let focusFiles = 0;

for (const file of files) {
  if (TOKENS.includes(file.replace(/\\/g, "/"))) continue;
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");

  lines.forEach((line, i) => {
    const n = i + 1;
    const code = line.replace(/\/\/.*$/, "");

    // 1) ألوان مباشرة
    if (/#[0-9a-fA-F]{3,8}\b/.test(code) && !/var\(--/.test(code)) add(file, n, "لون مباشر", line);
    if (/\b(rgb|rgba|hsl|hsla)\s*\(/.test(code) && !/var\(--/.test(code)) add(file, n, "لون مباشر", line);

    // 2) خطوط ممنوعة
    for (const f of BANNED_FONTS) {
      if (new RegExp(`["'\\s]${f}["',]`).test(code)) add(file, n, `خط ممنوع: ${f}`, line);
    }
    if (/font-family/.test(code) && !ALLOWED_FONTS.some((f) => code.includes(f)) && !/var\(--font/.test(code)) {
      add(file, n, "font-family غير معتمد", line);
    }

    // 3) أنصاف أقطار بقيمة مباشرة (غير 999px و 50%)
    const r = code.match(/border-?[Rr]adius\s*[:=]\s*["']?([^;"'}]+)/);
    if (r && !/var\(--/.test(r[1]) && !/999|50%|9999/.test(r[1])) add(file, n, "نصف قطر بقيمة مباشرة", line);

    // 4) ظلال بقيمة مباشرة
    if (/box-?[Ss]hadow\s*[:=]/.test(code) && !/var\(--shadow/.test(code) && !/none/.test(code)) {
      add(file, n, "ظل بقيمة مباشرة", line);
    }

    // 5) مسافات بقيم غريبة في Tailwind arbitrary
    if (/\[(?:\d+px|#[0-9a-fA-F]{3,8})\]/.test(code)) add(file, n, "قيمة Tailwind عشوائية", line);
  });

  // 6) حالات التركيز: أي ملف فيه عنصر تفاعلي يجب أن يعرّف focus-visible (في ملف المكوّن أو ملف الأنماط)
  if (/(<button|<input|<select|<textarea|role=["']button|onClick)/.test(src)) {
    interactiveFiles++;
    if (/focus-visible/.test(src)) focusFiles++;
  }
}

// تقرير
const byRule = problems.reduce((m, p) => ((m[p.rule] = (m[p.rule] || 0) + 1), m), {});

console.log(`\nفحص ${files.length} ملفاً في ${ROOT}/\n`);

if (problems.length === 0) {
  console.log("✅ لا مخالفات توكنات.");
} else {
  for (const p of problems) console.log(`✖ ${p.file}:${p.line} — ${p.rule}\n    ${p.text}`);
  console.log("\nالملخّص:");
  for (const [rule, count] of Object.entries(byRule)) console.log(`  ${rule}: ${count}`);
}

console.log(`\nملفات فيها عناصر تفاعلية: ${interactiveFiles} — منها تعرّف focus-visible: ${focusFiles}`);
if (interactiveFiles > 0 && focusFiles === 0) {
  console.log("✖ لا يوجد أي تعريف لـ :focus-visible. النظام يمنع حلقة التركيز الافتراضية.");
}

console.log(`
تذكير بما لا يفحصه هذا السكربت وعليك مراجعته بصرياً:
  - مطابقة التخطيط لصور design_handoff_verification_platform/screens/
  - نصوص الواجهة العربية كما في المواصفات دون إعادة صياغة
  - الوضع الداكن في لوحة السوبر أدمن
  - عدم ذكر أي مزوّد بيانات خارجي أو حقول مفاتيح خاصة بالمشترك
`);

process.exit(problems.length > 0 || (interactiveFiles > 0 && focusFiles === 0) ? 1 : 0);
