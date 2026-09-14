import { describe, expect, it } from 'vitest';
import {
  OPERATOR_SESSION_HOURS,
  operatorPanelEnabled,
  operatorSessionValue,
  operatorTokenMatches,
  verifyOperatorSession,
} from '../src/lib/operator';

/**
 * Unit 74: a sign in to the administration panel.
 *
 * The browser never holds the token. It holds a value derived from it that expires, and
 * that stops working for everybody the moment the token is rotated.
 */

const TOKEN = 'operator-token-long-enough-1234';
const NOW = Date.UTC(2026, 8, 14, 9, 0, 0);

describe('the operator session', () => {
  it('accepts the value it issued, until it expires', () => {
    const value = operatorSessionValue(TOKEN, NOW + 3_600_000);
    expect(verifyOperatorSession(TOKEN, value, NOW)).toBe(true);
    expect(verifyOperatorSession(TOKEN, value, NOW + 3_600_001)).toBe(false);
  });

  it('never contains the token itself', () => {
    const value = operatorSessionValue(TOKEN, NOW + 60_000);
    expect(value).not.toContain(TOKEN);
  });

  it('refuses a value whose expiry was edited', () => {
    const value = operatorSessionValue(TOKEN, NOW + 3_600_000);
    const [version, , mac] = value.split('.');
    const stretched = `${version}.${NOW + 7_200_000}.${mac}`;
    expect(verifyOperatorSession(TOKEN, stretched, NOW)).toBe(false);
  });

  it('refuses a value claiming a longer life than any sign in has', () => {
    const tooLong = operatorSessionValue(TOKEN, NOW + (OPERATOR_SESSION_HOURS + 2) * 3_600_000);
    expect(verifyOperatorSession(TOKEN, tooLong, NOW)).toBe(false);
  });

  it('signs everybody out when the token is rotated', () => {
    const value = operatorSessionValue(TOKEN, NOW + 3_600_000);
    expect(verifyOperatorSession('a-different-token-just-as-long-99', value, NOW)).toBe(false);
  });

  it('refuses the raw token presented as a session', () => {
    expect(verifyOperatorSession(TOKEN, TOKEN, NOW)).toBe(false);
  });

  it('has no panel without a long enough token', () => {
    expect(operatorPanelEnabled({})).toBe(false);
    expect(operatorPanelEnabled({ NX_OPERATOR_TOKEN: 'short' })).toBe(false);
    expect(operatorPanelEnabled({ NX_OPERATOR_TOKEN: TOKEN })).toBe(true);
    expect(operatorTokenMatches(TOKEN, { NX_OPERATOR_TOKEN: 'short' })).toBe(false);
    expect(operatorTokenMatches('', { NX_OPERATOR_TOKEN: TOKEN })).toBe(false);
    expect(operatorTokenMatches(TOKEN, { NX_OPERATOR_TOKEN: TOKEN })).toBe(true);
  });
});
