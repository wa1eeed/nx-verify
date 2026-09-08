import { describe, it } from 'vitest';

/**
 * Guard 03: same key, same result, one charge
 *
 * Rule 7. Every POST accepts Idempotency-Key and honours it. The same key returns the same result and is billed once.
 *
 * Activated in unit 6. The file exists from day one because the guards are written
 * before the logic they constrain, and an empty file is an honest signal that the
 * constraint has no implementation to bite yet. A todo does not turn CI green falsely.
 */
describe('guard 03: same key, same result, one charge', () => {
  it.todo('replaying an Idempotency-Key returns the stored run and adds no ledger entry');
});
