import { describe, it } from 'vitest';

/**
 * Guard 07: changing a TTL touches no attestation
 *
 * ADR-007. Freshness is arithmetic, not a call. Editing ttl_days recomputes and never writes to attestations.
 *
 * Activated in unit 2. The file exists from day one because the guards are written
 * before the logic they constrain, and an empty file is an honest signal that the
 * constraint has no implementation to bite yet. A todo does not turn CI green falsely.
 */
describe('guard 07: changing a TTL touches no attestation', () => {
  it.todo('editing freshness_policy leaves every attestation row byte identical');
});
