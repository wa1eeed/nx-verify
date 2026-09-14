#!/usr/bin/env node
/**
 * NX Trust: compares two sets of screenshots taken by shots-all.mjs, pixel by pixel.
 *
 *   node verify/compare-shots.mjs <before-dir> <after-dir> [max-changed-percent=0.5]
 *
 * Writes a diff image beside every pair that differs and exits 1 when any screen changed more
 * than the allowed share of its pixels or changed height. Times printed on a screen («منذ
 * دقيقة») move a few pixels between runs, which is what the allowance is for; anything above
 * it is a change somebody must look at.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const [before, after, limitArg] = process.argv.slice(2);
if (!before || !after) {
  console.error(
    'usage: node verify/compare-shots.mjs <before-dir> <after-dir> [max-changed-percent]',
  );
  process.exit(2);
}
const limit = Number(limitArg ?? 0.5);
let failed = 0;

for (const size of readdirSync(before, { withFileTypes: true }).filter((entry) =>
  entry.isDirectory(),
)) {
  for (const file of readdirSync(join(before, size.name)).filter((name) => name.endsWith('.png'))) {
    const a = join(before, size.name, file);
    const b = join(after, size.name, file);
    if (!existsSync(b)) {
      console.log(`✖ ${size.name}/${file}: missing after`);
      failed += 1;
      continue;
    }
    const left = PNG.sync.read(readFileSync(a));
    const right = PNG.sync.read(readFileSync(b));
    if (left.width !== right.width || left.height !== right.height) {
      console.log(
        `✖ ${size.name}/${file}: size ${left.width}x${left.height} → ${right.width}x${right.height}`,
      );
      failed += 1;
      continue;
    }
    const diff = new PNG({ width: left.width, height: left.height });
    const changed = pixelmatch(left.data, right.data, diff.data, left.width, left.height, {
      threshold: 0.1,
    });
    const percent = (changed / (left.width * left.height)) * 100;
    if (changed > 0) {
      mkdirSync(join(after, 'diff', size.name), { recursive: true });
      writeFileSync(join(after, 'diff', size.name, file), PNG.sync.write(diff));
    }
    const mark = percent > limit ? '✖' : '✓';
    if (percent > limit) {
      failed += 1;
    }
    console.log(`${mark} ${size.name}/${file}: ${percent.toFixed(3)}% changed`);
  }
}
process.exit(failed > 0 ? 1 : 0);
