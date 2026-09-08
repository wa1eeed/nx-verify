import { describe, it } from 'vitest';

/**
 * Guard 08: a non required step failure yields PARTIAL
 *
 * Default partial_policy is BEST_EFFORT: return PARTIAL, not ERROR, and mark dependants SKIPPED.
 *
 * Activated in unit 4. The file exists from day one because the guards are written
 * before the logic they constrain, and an empty file is an honest signal that the
 * constraint has no implementation to bite yet. A todo does not turn CI green falsely.
 */
describe('guard 08: a non required step failure yields PARTIAL', () => {
  it.todo('a failing optional step produces run status PARTIAL and dependants SKIPPED');
});
