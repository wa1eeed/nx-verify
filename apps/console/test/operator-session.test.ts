import { afterEach, describe, expect, it } from 'vitest';
import {
  OPERATOR_SESSION_HOURS,
  TOKEN_OPERATOR,
  currentOperator,
  operatorPanelEnabled,
  operatorSessionValue,
  operatorTokenMatches,
  readOperatorSession,
} from '../src/lib/operator';

/**
 * A sign in to the administration panel, as a named member of staff (PLAN.md, decision 5).
 *
 * The browser never holds the token. It holds a value naming the account, sealed with the
 * token, that expires and that stops working for everybody the moment the token is rotated.
 * The token itself makes the first owner and, outside production, stands in for a script.
 */

const TOKEN = 'operator-token-long-enough-1234';
const NOW = Date.UTC(2026, 8, 14, 9, 0, 0);
const ACCOUNT = '5b0e8f2c-3d9a-4c61-9e27-7f4a1b2c3d4e';
const OTHER = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

describe('the operator session', () => {
  it('names the account it was issued for, until it expires', () => {
    const value = operatorSessionValue(TOKEN, ACCOUNT, NOW + 3_600_000);
    expect(readOperatorSession(TOKEN, value, NOW)).toBe(ACCOUNT);
    expect(readOperatorSession(TOKEN, value, NOW + 3_600_001)).toBeNull();
  });

  it('never contains the token itself', () => {
    const value = operatorSessionValue(TOKEN, ACCOUNT, NOW + 60_000);
    expect(value).not.toContain(TOKEN);
  });

  it('refuses a value whose expiry was edited', () => {
    const value = operatorSessionValue(TOKEN, ACCOUNT, NOW + 3_600_000);
    const [version, account, , mac] = value.split('.');
    const stretched = `${version}.${account}.${NOW + 7_200_000}.${mac}`;
    expect(readOperatorSession(TOKEN, stretched, NOW)).toBeNull();
  });

  it('refuses a value whose account was swapped for another', () => {
    const value = operatorSessionValue(TOKEN, ACCOUNT, NOW + 3_600_000);
    const [version, , expires, mac] = value.split('.');
    expect(readOperatorSession(TOKEN, `${version}.${OTHER}.${expires}.${mac}`, NOW)).toBeNull();
  });

  it('refuses a value claiming a longer life than any sign in has', () => {
    const tooLong = operatorSessionValue(
      TOKEN,
      ACCOUNT,
      NOW + (OPERATOR_SESSION_HOURS + 2) * 3_600_000,
    );
    expect(readOperatorSession(TOKEN, tooLong, NOW)).toBeNull();
  });

  it('signs everybody out when the token is rotated', () => {
    const value = operatorSessionValue(TOKEN, ACCOUNT, NOW + 3_600_000);
    expect(readOperatorSession('a-different-token-just-as-long-99', value, NOW)).toBeNull();
  });

  it('refuses the raw token, and a session from before staff had accounts', () => {
    expect(readOperatorSession(TOKEN, TOKEN, NOW)).toBeNull();
    expect(readOperatorSession(TOKEN, `v1.${NOW + 60_000}.abc`, NOW)).toBeNull();
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

describe('the token in place of a person', () => {
  const saved = {
    token: process.env['NX_OPERATOR_TOKEN'],
    override: process.env['NX_OPERATOR_TOKEN_OVERRIDE'],
    env: process.env['NODE_ENV'],
  };

  afterEach(() => {
    const env = process.env as Record<string, string | undefined>;
    // Assigned rather than deleted: an unset variable reads back as undefined either way.
    env['NX_OPERATOR_TOKEN'] = saved.token;
    env['NX_OPERATOR_TOKEN_OVERRIDE'] = saved.override;
    env['NODE_ENV'] = saved.env;
    if (saved.token === undefined) {
      delete env['NX_OPERATOR_TOKEN'];
    }
    if (saved.override === undefined) {
      delete env['NX_OPERATOR_TOKEN_OVERRIDE'];
    }
    if (saved.env === undefined) {
      delete env['NODE_ENV'];
    }
  });

  it('acts as the deployment for a script, outside production', async () => {
    process.env['NX_OPERATOR_TOKEN'] = TOKEN;
    process.env['NX_OPERATOR_TOKEN_OVERRIDE'] = TOKEN;
    await expect(currentOperator()).resolves.toEqual(TOKEN_OPERATOR);
  });

  it('opens nothing in production, where staff sign in as themselves', async () => {
    process.env['NX_OPERATOR_TOKEN'] = TOKEN;
    process.env['NX_OPERATOR_TOKEN_OVERRIDE'] = TOKEN;
    (process.env as Record<string, string>)['NODE_ENV'] = 'production';
    await expect(currentOperator()).rejects.toThrow(/signed in member of staff/);
  });

  it('refuses a wrong token anywhere', async () => {
    process.env['NX_OPERATOR_TOKEN'] = TOKEN;
    process.env['NX_OPERATOR_TOKEN_OVERRIDE'] = 'a-different-token-just-as-long-99';
    await expect(currentOperator()).rejects.toThrow();
  });
});
