import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { withTenant } from '../../../packages/db/src/client';
import { createUser } from '../../../packages/core/src/auth/users';
import { setPassword } from '../../../packages/core/src/auth/passwords';
import { addSsoDomain, configureIdp } from '../../../packages/core/src/auth/sso';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db';
import { FakeIdp } from '../../../test/helpers/idp';
import { SignIn } from '../components/sign-in';
import { SIGN_IN_FAILED, finishSso, sessionCookie, signInWithPassword, startSso } from '../lib/auth';
import { closePool } from '../lib/context';

/**
 * Unit 28 acceptance: a person can actually get in, through either door.
 *
 * The screen tests are about what a login form must not say. The flow tests run the
 * console's own sign in path against a real database and a provider speaking the real
 * protocol, so what is proven here is what runs.
 */

const PASSWORD = 'correct horse battery staple';
const SECRET_REF = 'kms://tenants/console/idp';

describe('the sign in screen', () => {
  const html = renderToStaticMarkup(
    <SignIn error={null} passwordAction="/login/password" ssoAction="/login/sso" />,
  );

  it('offers one primary action, with the directory door beside it as secondary', () => {
    expect(html.match(/btn-primary/g)?.length).toBe(1);
    expect(html).toContain('btn-secondary');
    expect(html).toContain('data-role="sso-submit"');
  });

  it('says the same thing whatever went wrong', () => {
    const failed = renderToStaticMarkup(
      <SignIn error={SIGN_IN_FAILED} passwordAction="/a" ssoAction="/b" />,
    );
    expect(failed).toContain('data-role="sign-in-error"');
    expect(failed).toContain(SIGN_IN_FAILED);
    // None of the three things a prober wants to learn.
    expect(failed).not.toContain('كلمة المرور غير صحيحة');
    expect(failed).not.toContain('لا يوجد مستخدم');
    expect(failed).not.toContain('مساحة عمل غير موجودة');
  });

  it('keeps the address and the workspace in a left to right run', () => {
    expect(html).toContain('id="email"');
    expect(html).toContain('id="slug"');
    // Both are typed in Latin script and must not reflow inside an RTL page.
    expect(html.match(/dir="ltr"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('type="password"');
  });
});

describe('the console sign in path', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let idp: FakeIdp;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Console Tenant');
    idp = new FakeIdp();
    process.env['NX_APP_DATABASE_URL'] = db.appConnectionString;
    process.env['NX_CONSOLE_URL'] = 'https://console.nx.sa';

    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await tx.query(`UPDATE tenants SET slug = 'console-tenant' WHERE id = $1`, [tenant.tenantId]);
      const userId = await createUser(tx, {
        email: 'admin@console.example.sa',
        displayName: 'مسؤول',
        role: 'ADMIN',
      });
      await setPassword(tx, { userId, password: PASSWORD });

      await configureIdp(tx, {
        issuer: idp.issuer,
        clientId: idp.clientId,
        clientSecretRef: SECRET_REF,
        discoveryUrl: idp.discoveryUrl,
        roleMap: { 'nx-analysts': 'ANALYST' },
        defaultRole: 'VIEWER',
      });
      await addSsoDomain(tx, 'console.example.sa', { verified: true });
    });
  });

  afterAll(async () => {
    await closePool();
    await db.close();
    delete process.env['NX_APP_DATABASE_URL'];
    delete process.env['NX_CONSOLE_URL'];
  });

  it('signs a person in with a password and hands back a session cookie', async () => {
    const signed = await signInWithPassword({
      slug: 'console-tenant',
      email: 'admin@console.example.sa',
      password: PASSWORD,
    });

    expect(signed.token).toMatch(/^nxs_/);
    const cookie = sessionCookie(signed);
    // A script on the page must not be able to read it, and the browser has to send it
    // when the identity provider redirects the person back.
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.sameSite).toBe('lax');
    expect(cookie.options.path).toBe('/');
    expect(cookie.options.expires).toEqual(signed.expiresAt);
  });

  it('refuses a wrong password without saying which part was wrong', async () => {
    await expect(
      signInWithPassword({
        slug: 'console-tenant',
        email: 'admin@console.example.sa',
        password: 'not the password',
      }),
    ).rejects.toThrow();

    // And an address nobody here has, answered the same way.
    await expect(
      signInWithPassword({
        slug: 'console-tenant',
        email: 'nobody@console.example.sa',
        password: PASSWORD,
      }),
    ).rejects.toThrow();
  });

  it('sends a work address to its own directory and finishes the round trip', async () => {
    const redirect = await startSso('someone@console.example.sa', idp);
    expect(redirect.authorizationUrl).toContain(idp.authorizationEndpoint);
    // The address the provider sends the person back to is ours, and it is the one the
    // token exchange will repeat.
    expect(new URL(redirect.authorizationUrl).searchParams.get('redirect_uri')).toBe(
      'https://console.nx.sa/sso/callback',
    );

    const code = idp.authorize(redirect.authorizationUrl, {
      subject: 'idp-console-1',
      email: 'someone@console.example.sa',
      name: 'موظف',
      groups: ['nx-analysts'],
    });

    const signed = await finishSso({ state: redirect.state, code }, idp, () =>
      Promise.resolve('the-client-secret'),
    );
    expect(signed.token).toMatch(/^nxs_/);
    expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses a callback that carries a state this console did not start', async () => {
    await expect(
      finishSso({ state: 'a-state-from-nowhere', code: 'whatever' }, idp, () =>
        Promise.resolve('the-client-secret'),
      ),
    ).rejects.toThrow();
  });
});
