import { describe, it } from 'vitest';

/**
 * Guard 06: no provider name in a public response
 *
 * Rule 5. The exposed field is authority, the official source. source is internal only.
 *
 * Activated in unit 3. The file exists from day one because the guards are written
 * before the logic they constrain, and an empty file is an honest signal that the
 * constraint has no implementation to bite yet. A todo does not turn CI green falsely.
 */
describe('guard 06: no provider name in a public response', () => {
  it.todo('no public response body or error payload contains a provider name');
});
