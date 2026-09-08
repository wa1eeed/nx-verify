import { describe, it } from 'vitest';

/**
 * Guard 04: a SKIPPED step is billed at zero
 *
 * A step skipped because a dependency failed carries billed_amount zero. See partial_policy in docs/03-products.md.
 *
 * Activated in unit 6. The file exists from day one because the guards are written
 * before the logic they constrain, and an empty file is an honest signal that the
 * constraint has no implementation to bite yet. A todo does not turn CI green falsely.
 */
describe('guard 04: a SKIPPED step is billed at zero', () => {
  it.todo('a SKIPPED step writes billed_amount 0 and never reaches the wallet ledger');
});
