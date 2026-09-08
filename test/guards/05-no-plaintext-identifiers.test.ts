import { describe, it } from 'vitest';

/**
 * Guard 05: no plaintext identifier anywhere
 *
 * Rule 4. National ids and personal identifiers are stored as an HMAC hash for lookup and encrypted for display, never as text, and never in logs, error messages or backups.
 *
 * Activated in unit 1. The file exists from day one because the guards are written
 * before the logic they constrain, and an empty file is an honest signal that the
 * constraint has no implementation to bite yet. A todo does not turn CI green falsely.
 */
describe('guard 05: no plaintext identifier anywhere', () => {
  it.todo('no column, log line or error message contains an identifier in clear text');
});
