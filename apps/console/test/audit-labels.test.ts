import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionLabel } from '../src/components/audit-trail';

/**
 * Every action the domain writes has a word (ADR-167).
 *
 * The trail carried labels for two events nothing wrote, and no label for eighteen it did, so
 * those rendered as their own English code to an Arabic reader. That is what happens when a
 * screen's vocabulary is kept by hand beside a set of call sites nothing holds it against.
 */

const core = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'packages', 'core', 'src');

/** Every action string passed to audit() in the domain, read from the source. */
function actionsWritten(): string[] {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.ts')) {
        continue;
      }
      const source = readFileSync(full, 'utf8');
      // Only audit(), not recordOperatorAudit(): the panel keeps its own vocabulary, and the
      // two trails are read by different people for different reasons.
      for (const call of source.matchAll(/\baudit\(\s*tx\s*,\s*\{[^}]*?action:\s*'([^']+)'/gs)) {
        const action = call[1];
        if (action !== undefined) {
          found.add(action);
        }
      }
    }
  };
  walk(core);
  return [...found].sort();
}

describe('the audit trail vocabulary', () => {
  it('names every action the domain writes, in Arabic', () => {
    const unnamed = actionsWritten().filter((action) => actionLabel(action) === action);
    expect(unnamed).toEqual([]);
  });

  it('finds the actions at all, so a passing test means something', () => {
    // A regex that stops matching would make the test above pass by finding nothing.
    const written = actionsWritten();
    expect(written.length).toBeGreaterThan(15);
    expect(written).toContain('user.role_changed');
  });
});
