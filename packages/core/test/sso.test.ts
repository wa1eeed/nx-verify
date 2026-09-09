import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import { createUser, disableUser, resolveSession } from '../src/auth/users.js';
import { login, setPassword } from '../src/auth/passwords.js';
import { readAudit } from '../src/auth/audit.js';
import {
  addSsoDomain,
  beginSso,
  completeSso,
  configureIdp,
  verifyIdToken,
  type RunInTenant,
} from '../src/auth/sso.js';
import { NxError } from '../src/errors.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { FakeIdp } from '../../../test/helpers/idp.js';

/**
 * Signing in through the customer's own directory.
 *
 * The reason a company wants this is that when someone leaves, they stop being able to
 * sign in. Most of what follows is about the ways that promise breaks: an account matched
 * by an address the directory reassigned, a role read once and kept, a token minted for
 * someone else, a login replayed, a password door left open beside the new one.
 */

const REDIRECT = 'https://console.nx.sa/sso/callback';
const SECRET_REF = 'kms://tenants/sso/client-secret';

describe('single sign on', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let other: SeededTenant;
  let idp: FakeIdp;
  let runInTenant: RunInTenant;

  const clientSecretFor = (ref: string) => {
    // Rule 10: the row holds a reference, and the secret comes from the store.
    expect(ref).toBe(SECRET_REF);
    return Promise.resolve('the-client-secret');
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'SSO Tenant');
    other = await seedTenant(db.appPool, 'Other Tenant');
    idp = new FakeIdp();
    runInTenant = ((tenantId, handler) =>
      withTenant(db.appPool, tenantId, handler)) as RunInTenant;

    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await configureIdp(tx, {
        issuer: idp.issuer,
        clientId: idp.clientId,
        clientSecretRef: SECRET_REF,
        discoveryUrl: idp.discoveryUrl,
        roleClaim: 'groups',
        roleMap: { 'nx-admins': 'ADMIN', 'nx-analysts': 'ANALYST', 'nx-approvers': 'APPROVER' },
        defaultRole: null,
        allowJit: true,
      });
      await addSsoDomain(tx, 'client.example.sa', { verified: true });
      await addSsoDomain(tx, 'unverified.example.sa');
    });
  });

  afterAll(async () => {
    await db.close();
  });

  const signIn = async (options: Parameters<FakeIdp['authorize']>[1] = {}, email = 'sara@client.example.sa') => {
    const redirect = await beginSso(db.appPool, runInTenant, {
      email,
      redirectUri: REDIRECT,
      fetcher: idp,
    });
    const code = idp.authorize(redirect.authorizationUrl, options);
    const result = await completeSso(db.appPool, runInTenant, {
      state: redirect.state,
      code,
      fetcher: idp,
      clientSecretFor,
    });
    return { redirect, result };
  };

  it('sends the person to their own provider, with a challenge and a nonce', async () => {
    const redirect = await beginSso(db.appPool, runInTenant, {
      email: 'sara@client.example.sa',
      redirectUri: REDIRECT,
      fetcher: idp,
    });

    const url = new URL(redirect.authorizationUrl);
    expect(url.origin + url.pathname).toBe(idp.authorizationEndpoint);
    expect(url.searchParams.get('client_id')).toBe(idp.clientId);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(url.searchParams.get('state')).toBe(redirect.state);

    // The state is stored as a hash, like every other token here.
    const stored = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ state_hash: Buffer }>('SELECT state_hash FROM sso_login_requests'),
    );
    expect(stored.rows.length).toBeGreaterThan(0);
    for (const row of stored.rows) {
      expect(row.state_hash.toString('hex')).not.toContain(redirect.state);
    }
  });

  it('creates the person on first sign in, with the role their group maps to', async () => {
    const { result } = await signIn({
      subject: 'idp-sara',
      email: 'sara@client.example.sa',
      name: 'سارة',
      groups: ['nx-analysts'],
    });

    expect(result.created).toBe(true);
    expect(result.tenantId).toBe(tenant.tenantId);
    expect(result.role).toBe('ANALYST');
    expect(result.displayName).toBe('سارة');

    // A real session, resolvable the same way a password login's session is.
    const session = await withoutTenant(db.appPool, (tx) =>
      resolveSession(tx, result.session.token),
    );
    expect(session?.tenantId).toBe(tenant.tenantId);
    expect(session?.role).toBe('ANALYST');
  });

  it('follows a role change in the directory on the next sign in', async () => {
    const first = await signIn({ subject: 'idp-omar', email: 'omar@client.example.sa', groups: ['nx-analysts'] });
    expect(first.result.role).toBe('ANALYST');

    // Promoted in the customer's directory, which is where that decision belongs.
    const second = await signIn({ subject: 'idp-omar', email: 'omar@client.example.sa', groups: ['nx-approvers'] });
    expect(second.result.created).toBe(false);
    expect(second.result.userId).toBe(first.result.userId);
    expect(second.result.role).toBe('APPROVER');
  });

  it('matches the person by their subject, not by the address the directory gave them', async () => {
    const first = await signIn({ subject: 'idp-noura', email: 'noura@client.example.sa', groups: ['nx-analysts'] });

    // The directory changes her address. She is the same person, and must not get a
    // second account.
    const second = await signIn({
      subject: 'idp-noura',
      email: 'noura.alharbi@client.example.sa',
      groups: ['nx-analysts'],
    });
    expect(second.result.userId).toBe(first.result.userId);

    // And a joiner handed her old address is a different person, not her.
    const joiner = await signIn({ subject: 'idp-new-hire', email: 'noura@client.example.sa', groups: ['nx-analysts'] });
    expect(joiner.result.userId).not.toBe(first.result.userId);
  });

  it('never links a second subject to an account that already signed in here', async () => {
    const first = await signIn({ subject: 'idp-maha', email: 'maha@client.example.sa', groups: ['nx-analysts'] });

    // The second layer, on its own: even with the address still sitting on her row, a
    // different person at the directory gets their own account and not hers.
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(`UPDATE users SET email = 'maha@client.example.sa' WHERE tenant_id = $1 AND id = $2`, [
        tenant.tenantId,
        first.result.userId,
      ]),
    );

    // Refused, not linked. Handing this person that account is the one outcome that must
    // not happen, and renaming the other account silently is the second.
    await expect(
      signIn({
        subject: 'idp-someone-else',
        email: 'maha@client.example.sa',
        groups: ['nx-analysts'],
      }),
    ).rejects.toThrow(/still holds that address/);
  });

  it('links a person invited by address rather than making a second account', async () => {
    const invitedId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createUser(tx, {
        email: 'invited@client.example.sa',
        displayName: 'Invited Person',
        role: 'VIEWER',
      }),
    );

    const { result } = await signIn({
      subject: 'idp-invited',
      email: 'invited@client.example.sa',
      groups: ['nx-admins'],
    });

    expect(result.userId).toBe(invitedId);
    expect(result.created).toBe(false);
    expect(result.role).toBe('ADMIN');
  });

  it('refuses someone the workspace disabled, whatever the directory says', async () => {
    const { result } = await signIn({ subject: 'idp-leaver', email: 'leaver@client.example.sa', groups: ['nx-analysts'] });
    await withTenant(db.appPool, tenant.tenantId, (tx) => disableUser(tx, result.userId, "admin-under-test"));

    await expect(
      signIn({ subject: 'idp-leaver', email: 'leaver@client.example.sa', groups: ['nx-analysts'] }),
    ).rejects.toThrow(/disabled/);
  });

  it('refuses a person in no mapped group when there is no default role', async () => {
    await expect(
      signIn({ subject: 'idp-stranger', email: 'stranger@client.example.sa', groups: ['everyone'] }),
    ).rejects.toThrow(/no group/);
  });

  it('refuses a state that was already used', async () => {
    const redirect = await beginSso(db.appPool, runInTenant, {
      email: 'sara@client.example.sa',
      redirectUri: REDIRECT,
      fetcher: idp,
    });
    const code = idp.authorize(redirect.authorizationUrl, {
      subject: 'idp-sara',
      email: 'sara@client.example.sa',
      groups: ['nx-analysts'],
    });

    await completeSso(db.appPool, runInTenant, {
      state: redirect.state,
      code,
      fetcher: idp,
      clientSecretFor,
    });

    // The same callback again, which is what a replayed code looks like.
    await expect(
      completeSso(db.appPool, runInTenant, {
        state: redirect.state,
        code,
        fetcher: idp,
        clientSecretFor,
      }),
    ).rejects.toThrow(/expired or was already used/);
  });

  it('refuses a token that belongs to a different sign in', async () => {
    const redirect = await beginSso(db.appPool, runInTenant, {
      email: 'sara@client.example.sa',
      redirectUri: REDIRECT,
      fetcher: idp,
    });
    // A token minted with a nonce from somewhere else.
    const code = idp.authorize(redirect.authorizationUrl, {
      subject: 'idp-sara',
      groups: ['nx-analysts'],
      nonce: 'a-nonce-from-another-login',
    });

    await expect(
      completeSso(db.appPool, runInTenant, {
        state: redirect.state,
        code,
        fetcher: idp,
        clientSecretFor,
      }),
    ).rejects.toThrow(/does not belong to this sign in/);
  });

  it('sends the code verifier and the secret to the token endpoint, and never the secret to the browser', async () => {
    const before = idp.tokenRequests.length;
    const { redirect } = await signIn({ subject: 'idp-sara', groups: ['nx-analysts'] });

    const form = idp.tokenRequests[before];
    expect(form?.['grant_type']).toBe('authorization_code');
    expect(form?.['code_verifier']).toBeTruthy();
    expect(form?.['client_secret']).toBe('the-client-secret');
    // The redirect the person's browser follows carries neither.
    expect(redirect.authorizationUrl).not.toContain('the-client-secret');
    expect(redirect.authorizationUrl).not.toContain(form?.['code_verifier'] ?? 'unset');
  });

  it('refuses an address on a domain nobody proved, and one nobody routed', async () => {
    await expect(
      beginSso(db.appPool, runInTenant, {
        email: 'someone@unverified.example.sa',
        redirectUri: REDIRECT,
        fetcher: idp,
      }),
    ).rejects.toBeInstanceOf(NxError);

    await expect(
      beginSso(db.appPool, runInTenant, {
        email: 'someone@nowhere.example.sa',
        redirectUri: REDIRECT,
        fetcher: idp,
      }),
    ).rejects.toBeInstanceOf(NxError);
  });

  it('never routes one subscriber address to another subscriber workspace', async () => {
    // The other workspace claims the same domain. The unique index refuses it, so an
    // address cannot become ambiguous between two customers.
    await expect(
      withTenant(db.appPool, other.tenantId, (tx) =>
        addSsoDomain(tx, 'client.example.sa', { verified: true }),
      ),
    ).rejects.toThrow(/already routed/);

    const { result } = await signIn({ subject: 'idp-sara', groups: ['nx-analysts'] });
    expect(result.tenantId).toBe(tenant.tenantId);
    expect(result.tenantId).not.toBe(other.tenantId);
  });

  it('closes the password door for a workspace that enforces single sign on', async () => {
    const passwordUser = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const id = await createUser(tx, {
        email: 'legacy@client.example.sa',
        displayName: 'Legacy Login',
        role: 'VIEWER',
      });
      await setPassword(tx, { userId: id, password: 'correct horse battery staple' });
      await tx.query(`UPDATE tenants SET slug = 'sso-tenant' WHERE id = $1`, [tenant.tenantId]);
      return id;
    });
    expect(passwordUser).toBeTruthy();

    const attempt = () =>
      login(db.appPool, (tenantId, handler) => withTenant(db.appPool, tenantId, handler), {
        slug: 'sso-tenant',
        email: 'legacy@client.example.sa',
        password: 'correct horse battery staple',
      });

    // Open while single sign on is optional.
    await expect(attempt()).resolves.toBeTruthy();

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(`UPDATE tenant_idp SET enforce_sso = true WHERE tenant_id = $1`, [tenant.tenantId]),
    );

    // And closed in the lookup itself once it is not, so no route can forget to check.
    await expect(attempt()).rejects.toThrow(NxError);

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(`UPDATE tenant_idp SET enforce_sso = false WHERE tenant_id = $1`, [tenant.tenantId]),
    );
  });

  it('records the sign in without the token and without the address', async () => {
    const { result } = await signIn({ subject: 'idp-audit', email: 'audit@client.example.sa', groups: ['nx-admins'] });

    const entries = await withTenant(db.appPool, tenant.tenantId, (tx) => readAudit(tx, { limit: 20 }));
    const entry = entries.find((row) => row.target === result.userId);
    expect(entry?.action).toMatch(/^user\.sso_/);
    expect(JSON.stringify(entry)).not.toContain(result.session.token);
    expect(JSON.stringify(entry)).not.toContain('audit@client.example.sa');
  });
});

/**
 * The token checks on their own.
 *
 * Each one of these is a published way into a system that skipped it, which is why they
 * are written out in our own code rather than assumed from a dependency.
 */
describe('identity token verification', () => {
  const idp = new FakeIdp();
  const options = {
    issuer: idp.issuer,
    audience: idp.clientId,
    jwksUri: idp.jwksUri,
    fetcher: idp,
  };

  it('accepts a token the provider signed for us', async () => {
    const claims = await verifyIdToken(idp.mint({ subject: 'idp-1', email: 'a@b.sa' }), options);
    expect(claims.sub).toBe('idp-1');
  });

  it('refuses a token signed by a key the provider does not publish', async () => {
    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await expect(
      verifyIdToken(idp.mint({ key: stranger.privateKey }), options),
    ).rejects.toThrow(/signature does not verify/);
  });

  it('refuses a token whose payload was edited after signing', async () => {
    const tampered = idp.tamper(idp.mint({ subject: 'idp-1' }), { sub: 'idp-admin' });
    await expect(verifyIdToken(tampered, options)).rejects.toThrow(/signature does not verify/);
  });

  it('refuses alg none, and refuses the algorithm the token asks for', async () => {
    await expect(verifyIdToken(idp.mint({ algorithm: 'none' }), options)).rejects.toThrow(/RS256/);
    await expect(verifyIdToken(idp.mint({ algorithm: 'HS256' }), options)).rejects.toThrow(/RS256/);
  });

  it('refuses a token minted for another client of the same provider', async () => {
    await expect(verifyIdToken(idp.mint({ audience: 'someone-elses-app' }), options)).rejects.toThrow(
      /another client/,
    );
  });

  it('refuses a token from another issuer', async () => {
    await expect(verifyIdToken(idp.mint({ issuer: 'https://evil.example.com' }), options)).rejects.toThrow(
      /issued by someone else/,
    );
  });

  it('refuses an expired token and one dated in the future', async () => {
    await expect(verifyIdToken(idp.mint({ expiresInSeconds: -3600 }), options)).rejects.toThrow(
      /expired/,
    );
    await expect(
      verifyIdToken(idp.mint({ issuedAtOffsetSeconds: 3600 }), options),
    ).rejects.toThrow(/dated in the future/);
  });

  it('refuses a token that is not a token', async () => {
    await expect(verifyIdToken('not.a.token', options)).rejects.toThrow(/malformed/);
    await expect(verifyIdToken('nonsense', options)).rejects.toThrow(/malformed/);
  });
});
