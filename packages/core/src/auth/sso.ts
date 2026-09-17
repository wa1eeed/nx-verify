import { createHash, createPublicKey, createVerify, randomBytes } from 'node:crypto';
import type { Queryable, TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { audit } from './audit.js';
import { createSession, type IssuedSession, type UserRole } from './users.js';

/**
 * Signing in through the subscriber's own identity provider.
 *
 * The binding is at the level of the subscribing company, exactly like the provider
 * binding, and for the same reason: an employee no more chooses their employer's identity
 * provider than they choose its data provider. One company, one directory, one door.
 *
 * Everything a directory is for depends on one property: when someone leaves, they stop
 * being able to sign in. That only holds if the account here is the directory's account
 * and not a copy of it, which is why the match is on (issuer, subject) and never on the
 * email address, and why the role is read from the directory on every sign in rather than
 * kept here after the first.
 *
 * See ADR-051 and ADR-052.
 */

export type SsoRole = UserRole;

export interface HttpJson {
  status: number;
  body: unknown;
}

/**
 * The one seam to the outside.
 *
 * Discovery, the key set and the token exchange are the only calls this module makes, and
 * they all go through here, so a test drives a real provider protocol without a network.
 */
export interface SsoFetcher {
  get(url: string): Promise<HttpJson>;
  postForm(url: string, form: Record<string, string>): Promise<HttpJson>;
}

export interface IdpConfig {
  tenantId: string;
  issuer: string;
  clientId: string;
  clientSecretRef: string;
  discoveryUrl: string;
  authorizationEndpoint: string | null;
  tokenEndpoint: string | null;
  jwksUri: string | null;
  roleClaim: string;
  roleMap: Record<string, SsoRole>;
  defaultRole: SsoRole | null;
  allowJit: boolean;
}

export interface ConfigureIdpInput {
  issuer: string;
  clientId: string;
  clientSecretRef: string;
  discoveryUrl: string;
  roleClaim?: string;
  roleMap?: Record<string, SsoRole>;
  defaultRole?: SsoRole | null;
  allowJit?: boolean;
  enforceSso?: boolean;
}

/** Configured by the subscriber's own administrator: it is their directory. */
export async function configureIdp(
  tx: TenantTransaction,
  input: ConfigureIdpInput,
  actorId?: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO tenant_idp (tenant_id, issuer, client_id, client_secret_ref, discovery_url,
                             role_claim, role_map, default_role, allow_jit, enforce_sso)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
     ON CONFLICT (tenant_id) DO UPDATE SET
       issuer = EXCLUDED.issuer,
       client_id = EXCLUDED.client_id,
       client_secret_ref = EXCLUDED.client_secret_ref,
       discovery_url = EXCLUDED.discovery_url,
       role_claim = EXCLUDED.role_claim,
       role_map = EXCLUDED.role_map,
       default_role = EXCLUDED.default_role,
       allow_jit = EXCLUDED.allow_jit,
       enforce_sso = EXCLUDED.enforce_sso,
       -- The endpoints belong to the issuer, so a new issuer invalidates them.
       authorization_endpoint = NULL,
       token_endpoint = NULL,
       jwks_uri = NULL,
       discovered_at = NULL,
       updated_at = now()`,
    [
      tx.tenantId,
      input.issuer,
      input.clientId,
      input.clientSecretRef,
      input.discoveryUrl,
      input.roleClaim ?? 'groups',
      JSON.stringify(input.roleMap ?? {}),
      input.defaultRole ?? null,
      input.allowJit ?? true,
      input.enforceSso ?? false,
    ],
  );

  await audit(tx, {
    actorType: 'USER',
    actorId: actorId ?? 'system',
    action: 'sso.configured',
    target: tx.tenantId,
    metadata: { issuer: input.issuer, enforce_sso: input.enforceSso ?? false },
  });
}

/**
 * The email domains that route to this company.
 *
 * Unverified until someone proves the domain, and an unverified domain routes nobody: a
 * company that could claim a domain it does not own could claim the addresses of a
 * company that does.
 */
export async function addSsoDomain(
  tx: TenantTransaction,
  domain: string,
  options: { verified?: boolean } = {},
): Promise<void> {
  await tx
    .query(
      `INSERT INTO sso_domains (tenant_id, domain, verified_at)
       VALUES ($1, lower($2), CASE WHEN $3 THEN now() ELSE NULL END)
       ON CONFLICT (tenant_id, domain) DO UPDATE
         SET verified_at = CASE WHEN $3 THEN now() ELSE sso_domains.verified_at END`,
      [tx.tenantId, domain.trim(), options.verified ?? false],
    )
    .catch((error: unknown) => {
      if ((error as { code?: string }).code === '23505') {
        throw new NxError('NX-4091', { detail: 'that domain is already routed elsewhere' });
      }
      throw error;
    });
}

interface DomainRow {
  tenant_id: string;
  issuer: string;
  client_id: string;
  client_secret_ref: string;
  discovery_url: string;
  authorization_endpoint: string | null;
  token_endpoint: string | null;
  jwks_uri: string | null;
  role_claim: string;
  role_map: Record<string, SsoRole>;
  default_role: SsoRole | null;
  allow_jit: boolean;
}

export type RunInTenant = <T>(
  tenantId: string,
  handler: (tx: TenantTransaction) => Promise<T>,
) => Promise<T>;

export interface BeginSsoInput {
  /** What the person typed. Only the domain is used, and only the domain is stored. */
  email: string;
  redirectUri: string;
  fetcher: SsoFetcher;
  /** How long the person has to finish signing in at the provider. */
  ttlMinutes?: number;
}

export interface SsoRedirect {
  authorizationUrl: string;
  state: string;
}

export async function beginSso(
  db: Queryable,
  runInTenant: RunInTenant,
  input: BeginSsoInput,
): Promise<SsoRedirect> {
  const domain = domainOf(input.email);
  const { rows } = await db.query<DomainRow>(
    `SELECT tenant_id, issuer, client_id, client_secret_ref, discovery_url,
            authorization_endpoint, token_endpoint, jwks_uri,
            role_claim, role_map, default_role, allow_jit
     FROM app.resolve_sso_domain($1)`,
    [domain],
  );

  const found = rows[0];
  if (!found) {
    // The same answer a wrong password gets, and for the same reason: a login form that
    // says which companies are customers here is a directory of our customers.
    throw new NxError('NX-4011');
  }

  const config = toConfig(found);
  const endpoints = await ensureEndpoints(runInTenant, config, input.fetcher);

  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(48).toString('base64url');
  const codeChallenge = sha256(codeVerifier).toString('base64url');

  await runInTenant(config.tenantId, (tx) =>
    tx.query(
      `INSERT INTO sso_login_requests
         (tenant_id, state_hash, nonce_hash, code_verifier, redirect_uri, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6))`,
      [
        config.tenantId,
        sha256(state),
        sha256(nonce),
        codeVerifier,
        input.redirectUri,
        input.ttlMinutes ?? 10,
      ],
    ),
  );

  const url = new URL(endpoints.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  // PKCE, even though this is a confidential client with a secret. It costs one hash and
  // it closes code interception, which a redirect through a browser invites.
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return { authorizationUrl: url.toString(), state };
}

export interface CompleteSsoInput {
  state: string;
  code: string;
  fetcher: SsoFetcher;
  /** Rule 10: the client secret comes from the KMS, by the reference in the row. */
  clientSecretFor: (ref: string) => Promise<string>;
  ip?: string | null;
  /** Tolerance for clock difference between us and the provider. */
  clockSkewSeconds?: number;
}

export interface SsoLoginSuccess {
  tenantId: string;
  userId: string;
  role: SsoRole;
  displayName: string;
  session: IssuedSession;
  created: boolean;
}

export async function completeSso(
  db: Queryable,
  runInTenant: RunInTenant,
  input: CompleteSsoInput,
): Promise<SsoLoginSuccess> {
  const { rows } = await db.query<{
    id: string;
    tenant_id: string;
    nonce_hash: Buffer;
    code_verifier: string;
    redirect_uri: string;
  }>(
    `SELECT id, tenant_id, nonce_hash, code_verifier, redirect_uri
      FROM app.resolve_sso_request($1)`,
    [sha256(input.state)],
  );

  const request = rows[0];
  if (!request) {
    // Unknown, expired, or already used. One error for all three, because telling them
    // apart tells an attacker which of their guesses was a real login in flight.
    throw new NxError('NX-4011', { detail: 'this sign in has expired or was already used' });
  }

  // Claimed here, under the company's own scope, and claimed once: the condition is in
  // the statement, so two callbacks carrying the same state cannot both pass it. This is
  // what closes a replayed authorisation code.
  const claimed = await runInTenant(request.tenant_id, (tx) =>
    tx.query(
      `UPDATE sso_login_requests SET consumed_at = now()
       WHERE tenant_id = $1 AND id = $2 AND consumed_at IS NULL
       RETURNING id`,
      [request.tenant_id, request.id],
    ),
  );

  if (claimed.rowCount === 0) {
    throw new NxError('NX-4011', { detail: 'this sign in has expired or was already used' });
  }

  const config = await runInTenant(request.tenant_id, async (tx) => {
    const result = await tx.query<DomainRow>(
      `SELECT tenant_id, issuer, client_id, client_secret_ref, discovery_url,
              authorization_endpoint, token_endpoint, jwks_uri,
              role_claim, role_map, default_role, allow_jit
       FROM tenant_idp WHERE tenant_id = $1 AND status = 'active'`,
      [request.tenant_id],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NxError('NX-4011');
    }
    return toConfig(row);
  });

  const endpoints = await ensureEndpoints(runInTenant, config, input.fetcher);
  const secret = await input.clientSecretFor(config.clientSecretRef);

  const token = await input.fetcher.postForm(endpoints.tokenEndpoint, {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: request.redirect_uri,
    client_id: config.clientId,
    client_secret: secret,
    code_verifier: request.code_verifier,
  });

  if (token.status >= 400) {
    throw new NxError('NX-4011', { detail: 'the provider refused the authorisation code' });
  }

  const idToken = (token.body as { id_token?: unknown }).id_token;
  if (typeof idToken !== 'string') {
    throw new NxError('NX-4011', { detail: 'the provider returned no identity token' });
  }

  const claims = await verifyIdToken(idToken, {
    issuer: config.issuer,
    audience: config.clientId,
    jwksUri: endpoints.jwksUri,
    fetcher: input.fetcher,
    ...(input.clockSkewSeconds === undefined ? {} : { clockSkewSeconds: input.clockSkewSeconds }),
  });

  if (typeof claims.nonce !== 'string' || !sha256(claims.nonce).equals(request.nonce_hash)) {
    // Without this an identity token obtained elsewhere could be replayed into a login
    // started here.
    throw new NxError('NX-4011', { detail: 'the identity token does not belong to this sign in' });
  }

  const role = roleFor(claims, config);

  return runInTenant(config.tenantId, async (tx) => {
    const person = await upsertPerson(tx, config, claims, role);
    const session = await createSession(tx, { userId: person.userId, ip: input.ip ?? null });

    await audit(tx, {
      actorType: 'USER',
      actorId: person.userId,
      action: person.created ? 'user.sso_provisioned' : 'user.sso_login',
      target: person.userId,
      ...(input.ip === undefined ? {} : { ip: input.ip }),
      // The subject at the provider, not the address, and no token.
      metadata: { issuer: config.issuer, role },
    });

    return {
      tenantId: config.tenantId,
      userId: person.userId,
      role,
      displayName: person.displayName,
      session,
      created: person.created,
    };
  });
}

interface Endpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

/**
 * Discovery, cached on the row.
 *
 * Read once and kept, so a sign in does not depend on the provider answering a second
 * request while someone waits at a redirect.
 */
async function ensureEndpoints(
  runInTenant: RunInTenant,
  config: IdpConfig,
  fetcher: SsoFetcher,
): Promise<Endpoints> {
  if (config.authorizationEndpoint && config.tokenEndpoint && config.jwksUri) {
    return {
      authorizationEndpoint: config.authorizationEndpoint,
      tokenEndpoint: config.tokenEndpoint,
      jwksUri: config.jwksUri,
    };
  }

  const response = await fetcher.get(config.discoveryUrl);
  if (response.status >= 400) {
    throw new NxError('NX-5002', { detail: 'the identity provider did not answer discovery' });
  }

  const document = response.body as {
    issuer?: unknown;
    authorization_endpoint?: unknown;
    token_endpoint?: unknown;
    jwks_uri?: unknown;
  };

  // A discovery document that names a different issuer than the one configured is either
  // a misconfiguration or a redirect somewhere else. Both end the flow.
  if (document.issuer !== config.issuer) {
    throw new NxError('NX-4011', { detail: 'the discovery document names a different issuer' });
  }

  const endpoints: Endpoints = {
    authorizationEndpoint: requireUrl(document.authorization_endpoint, 'authorization_endpoint'),
    tokenEndpoint: requireUrl(document.token_endpoint, 'token_endpoint'),
    jwksUri: requireUrl(document.jwks_uri, 'jwks_uri'),
  };

  await runInTenant(config.tenantId, (tx) =>
    tx.query(
      `UPDATE tenant_idp
       SET authorization_endpoint = $2, token_endpoint = $3, jwks_uri = $4,
           discovered_at = now(), updated_at = now()
       WHERE tenant_id = $1`,
      [
        config.tenantId,
        endpoints.authorizationEndpoint,
        endpoints.tokenEndpoint,
        endpoints.jwksUri,
      ],
    ),
  );

  return endpoints;
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  name?: string;
  [claim: string]: unknown;
}

export interface VerifyIdTokenOptions {
  issuer: string;
  audience: string;
  jwksUri: string;
  fetcher: SsoFetcher;
  clockSkewSeconds?: number;
  now?: Date;
}

/**
 * Checking the identity token.
 *
 * Written out rather than pulled from a library, because every one of these checks is a
 * known way in when it is missing, and the list is short enough to read: a signature by a
 * key the issuer publishes, an algorithm we chose rather than one the token asked for,
 * the issuer we expected, an audience that is us, and a time that is now.
 */
export async function verifyIdToken(
  idToken: string,
  options: VerifyIdTokenOptions,
): Promise<IdTokenClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new NxError('NX-4011', { detail: 'the identity token is malformed' });
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  const header = decodeJson(encodedHeader) as { alg?: unknown; kid?: unknown };
  // The token does not get to choose. "none" is an algorithm in the specification and
  // accepting it means accepting anything; the HMAC family with a public key as the
  // secret is the other classic.
  if (header.alg !== 'RS256') {
    throw new NxError('NX-4011', { detail: 'the identity token is not signed with RS256' });
  }

  const jwks = await options.fetcher.get(options.jwksUri);
  if (jwks.status >= 400) {
    throw new NxError('NX-5002', { detail: 'the identity provider did not publish its keys' });
  }

  const keys = ((jwks.body as { keys?: unknown[] }).keys ?? []) as Record<string, unknown>[];
  const candidates =
    typeof header.kid === 'string' ? keys.filter((key) => key['kid'] === header.kid) : keys;
  if (candidates.length === 0) {
    throw new NxError('NX-4011', { detail: 'no published key matches this identity token' });
  }

  const signature = Buffer.from(encodedSignature, 'base64url');
  const signed = `${encodedHeader}.${encodedPayload}`;
  const verified = candidates.some((key) => {
    try {
      const publicKey = createPublicKey({ key: key as never, format: 'jwk' });
      return createVerify('RSA-SHA256').update(signed).verify(publicKey, signature);
    } catch {
      return false;
    }
  });

  if (!verified) {
    throw new NxError('NX-4011', { detail: 'the identity token signature does not verify' });
  }

  const claims = decodeJson(encodedPayload) as IdTokenClaims;
  const skew = options.clockSkewSeconds ?? 60;
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);

  if (claims.iss !== options.issuer) {
    throw new NxError('NX-4011', { detail: 'the identity token was issued by someone else' });
  }

  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(options.audience)) {
    // A token minted for another client of the same provider is a valid token, and using
    // it here would let that client's users sign in as ours.
    throw new NxError('NX-4011', { detail: 'the identity token was issued for another client' });
  }

  if (typeof claims.exp !== 'number' || claims.exp + skew < now) {
    throw new NxError('NX-4011', { detail: 'the identity token has expired' });
  }
  if (typeof claims.iat !== 'number' || claims.iat - skew > now) {
    throw new NxError('NX-4011', { detail: 'the identity token is dated in the future' });
  }
  if (typeof claims.sub !== 'string' || claims.sub === '') {
    throw new NxError('NX-4011', { detail: 'the identity token names no subject' });
  }

  return claims;
}

/**
 * Which role this person has, decided by the directory on every sign in.
 *
 * Not read once and kept, because the reason a company buys this is that their directory
 * is where joining, leaving and changing jobs are recorded. A role that only followed on
 * the first sign in would make us the stale copy.
 */
function roleFor(claims: IdTokenClaims, config: IdpConfig): SsoRole {
  const raw = claims[config.roleClaim];
  const groups = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];

  for (const group of groups) {
    const mapped = typeof group === 'string' ? config.roleMap[group] : undefined;
    if (mapped) {
      return mapped;
    }
  }

  if (config.defaultRole) {
    return config.defaultRole;
  }

  // No mapped group and no default. Refusing is the right answer for a platform that can
  // spend the customer's money: an unmapped person is one the customer never placed.
  throw new NxError('NX-4031', {
    detail: 'this account matches no group that the workspace has mapped to a role',
  });
}

interface PersonRow {
  userId: string;
  displayName: string;
  created: boolean;
}

async function upsertPerson(
  tx: TenantTransaction,
  config: IdpConfig,
  claims: IdTokenClaims,
  role: SsoRole,
): Promise<PersonRow> {
  const email = typeof claims.email === 'string' ? claims.email : null;
  const displayName =
    typeof claims.name === 'string' && claims.name !== '' ? claims.name : (email ?? claims.sub);

  // The match is on the subject at the provider, never on the address. Directories let
  // people change their address, and they hand a leaver's address to a joiner.
  const existing = await tx.query<{ user_id: string; status: string; display_name: string }>(
    `SELECT i.user_id, u.status, u.display_name
     FROM user_identities i
     JOIN users u ON u.tenant_id = i.tenant_id AND u.id = i.user_id
     WHERE i.tenant_id = $1 AND i.issuer = $2 AND i.subject = $3`,
    [tx.tenantId, config.issuer, claims.sub],
  );

  const found = existing.rows[0];
  if (found) {
    if (found.status !== 'active') {
      // Someone disabled here stays disabled, whatever the directory says. The two
      // controls are independent on purpose: either one can stop a person.
      throw new NxError('NX-4031', { detail: 'this account is disabled in the workspace' });
    }

    await tx.query(
      `UPDATE users SET role = $3, display_name = $4 WHERE tenant_id = $1 AND id = $2`,
      [tx.tenantId, found.user_id, role, displayName],
    );

    // The address follows the directory too. Left behind, a stale address would still be
    // sitting here when the directory hands it to a joiner, and the link below would then
    // attach that joiner to this account.
    if (email) {
      await tx.query(
        `UPDATE users u SET email = $3
         WHERE u.tenant_id = $1 AND u.id = $2 AND lower(u.email) <> lower($3)
           AND NOT EXISTS (
             SELECT 1 FROM users other
             WHERE other.tenant_id = u.tenant_id AND lower(other.email) = lower($3)
               AND other.id <> u.id
           )`,
        [tx.tenantId, found.user_id, email],
      );
    }

    await tx.query(
      `UPDATE user_identities SET last_login_at = now()
       WHERE tenant_id = $1 AND issuer = $2 AND subject = $3`,
      [tx.tenantId, config.issuer, claims.sub],
    );
    return { userId: found.user_id, displayName, created: false };
  }

  if (!config.allowJit) {
    throw new NxError('NX-4031', {
      detail: 'this workspace does not create accounts on first sign in',
    });
  }

  // A person invited here by address, signing in through the directory for the first
  // time: the account already exists and this links it rather than making a second one.
  //
  // Only an account that has never signed in through this directory. One that already has
  // an identity belongs to a different person at the provider, whatever address it
  // carries, and attaching a second subject to it would hand them that person's account.
  const byEmail = email
    ? await tx.query<{ id: string; status: string }>(
        `SELECT u.id, u.status
         FROM users u
         WHERE u.tenant_id = $1 AND lower(u.email) = lower($2)
           AND NOT EXISTS (
             SELECT 1 FROM user_identities i
             WHERE i.tenant_id = u.tenant_id AND i.user_id = u.id AND i.issuer = $3
           )`,
        [tx.tenantId, email, config.issuer],
      )
    : { rows: [] as { id: string; status: string }[] };

  const linked = byEmail.rows[0];
  if (linked) {
    if (linked.status !== 'active') {
      throw new NxError('NX-4031', { detail: 'this account is disabled in the workspace' });
    }
    await tx.query(
      `INSERT INTO user_identities (tenant_id, user_id, issuer, subject, last_login_at)
       VALUES ($1, $2, $3, $4, now())`,
      [tx.tenantId, linked.id, config.issuer, claims.sub],
    );
    await tx.query(
      `UPDATE users SET role = $3, display_name = $4 WHERE tenant_id = $1 AND id = $2`,
      [tx.tenantId, linked.id, role, displayName],
    );
    return { userId: linked.id, displayName, created: false };
  }

  const inserted = await tx
    .query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, display_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        tx.tenantId,
        email ?? `${claims.sub}@${config.issuer.replace(/^https?:\/\//, '')}`,
        displayName,
        role,
      ],
    )
    .catch((error: unknown) => {
      if ((error as { code?: string }).code === '23505') {
        // Another account here still holds this address, and it belongs to a different
        // person at the directory. Refusing is the only safe answer: linking would hand
        // this person that account, and taking the address would rename someone else.
        // An administrator releases the address from the old account.
        throw new NxError('NX-4091', {
          detail: 'another account in this workspace still holds that address',
        });
      }
      throw error;
    });

  const userId = inserted.rows[0]?.id;
  if (!userId) {
    throw new NxError('NX-5001', { detail: 'user insert returned no id' });
  }

  await tx.query(
    `INSERT INTO user_identities (tenant_id, user_id, issuer, subject, last_login_at)
     VALUES ($1, $2, $3, $4, now())`,
    [tx.tenantId, userId, config.issuer, claims.sub],
  );

  return { userId, displayName, created: true };
}

function toConfig(row: DomainRow): IdpConfig {
  return {
    tenantId: row.tenant_id,
    issuer: row.issuer,
    clientId: row.client_id,
    clientSecretRef: row.client_secret_ref,
    discoveryUrl: row.discovery_url,
    authorizationEndpoint: row.authorization_endpoint,
    tokenEndpoint: row.token_endpoint,
    jwksUri: row.jwks_uri,
    roleClaim: row.role_claim,
    roleMap: row.role_map ?? {},
    defaultRole: row.default_role,
    allowJit: row.allow_jit,
  };
}

function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  const domain =
    at === -1
      ? ''
      : email
          .slice(at + 1)
          .trim()
          .toLowerCase();
  if (domain === '') {
    throw new NxError('NX-4001', { detail: 'that is not an email address' });
  }
  return domain;
}

function requireUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^https?:\/\//.test(value)) {
    throw new NxError('NX-4011', { detail: `the discovery document has no usable ${field}` });
  }
  return value;
}

function decodeJson(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new NxError('NX-4011', { detail: 'the identity token is malformed' });
  }
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Claiming a domain, and proving it by DNS (ADR-153).
 *
 * `verified_at` has gated routing since single sign on was built, and nothing could set it, so
 * the feature could be configured and could never work while its form sat on the login screen
 * of every deployment.
 *
 * A TXT record is the proof because publishing DNS for a domain is the one thing only its
 * owner can do. Not a mailbox at the domain, which is not the domain; not a file on a web
 * server, which proves only that somebody can write to one host.
 */

const PROOF_PREFIX = 'nx-verify-domain=';

export interface SsoDomainRow {
  domain: string;
  verified: boolean;
  /** What to publish, while it is unproved. Cleared once the domain is proved. */
  proofToken: string | null;
  checkedAt: Date | null;
  lastError: string | null;
}

/** The exact record a subscriber has to publish. */
export function proofRecordFor(token: string): string {
  return `${PROOF_PREFIX}${token}`;
}

export async function listSsoDomains(tx: TenantTransaction): Promise<SsoDomainRow[]> {
  const { rows } = await tx.query<{
    domain: string;
    verified_at: Date | null;
    proof_token: string | null;
    checked_at: Date | null;
    last_error: string | null;
  }>(
    `SELECT domain, verified_at, proof_token, checked_at, last_error
       FROM sso_domains WHERE tenant_id = $1 ORDER BY domain`,
    [tx.tenantId],
  );
  return rows.map((row) => ({
    domain: row.domain,
    verified: row.verified_at !== null,
    proofToken: row.proof_token,
    checkedAt: row.checked_at,
    lastError: row.last_error,
  }));
}

/**
 * Claims a domain, unproved, with the token it must publish.
 *
 * A domain already claimed anywhere is refused: the unique index across every workspace says
 * so, and it is the whole point. Two companies cannot both route `example.com`.
 */
export async function claimSsoDomain(tx: TenantTransaction, domain: string): Promise<SsoDomainRow> {
  const value = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) {
    throw new NxError('NX-4002', {
      detail: 'that is not a domain',
      cause: 'اكتب نطاقاً مثل example.sa.',
    });
  }

  const token = randomBytes(16).toString('hex');
  await tx
    .query(
      `INSERT INTO sso_domains (tenant_id, domain, proof_token)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, domain) DO UPDATE
         SET proof_token = CASE WHEN sso_domains.verified_at IS NULL
                                THEN EXCLUDED.proof_token ELSE NULL END`,
      [tx.tenantId, value, token],
    )
    .catch((error: unknown) => {
      if ((error as { code?: string }).code === '23505') {
        throw new NxError('NX-4091', {
          detail: 'that domain is already claimed',
          cause: 'هذا النطاق مسجّل بالفعل.',
        });
      }
      throw error;
    });

  const rows = await listSsoDomains(tx);
  const row = rows.find((entry) => entry.domain === value);
  if (!row) {
    throw new NxError('NX-5001', { detail: 'the domain was not stored' });
  }
  return row;
}

/**
 * Looks the record up and proves the domain if it is there.
 *
 * The resolver is passed in rather than imported, so the domain layer stays testable without
 * a network and a deployment can put its own resolver in front of this.
 *
 * A failure is recorded on the row rather than thrown. «Not published yet» is the normal case
 * on the first attempt, not an error: somebody has just been told to edit their DNS, and zones
 * take minutes to propagate.
 */
export async function verifySsoDomain(
  tx: TenantTransaction,
  domain: string,
  resolveTxt: (name: string) => Promise<string[][]>,
): Promise<SsoDomainRow> {
  const { rows } = await tx.query<{ proof_token: string | null; verified_at: Date | null }>(
    `SELECT proof_token, verified_at FROM sso_domains WHERE tenant_id = $1 AND domain = $2`,
    [tx.tenantId, domain],
  );
  const pending = rows[0];
  if (!pending) {
    throw new NxError('NX-4041', { detail: 'no such domain', cause: 'لا نطاق بهذا الاسم.' });
  }
  if (pending.verified_at !== null) {
    const current = await listSsoDomains(tx);
    return current.find((entry) => entry.domain === domain) as SsoDomainRow;
  }

  const expected = proofRecordFor(pending.proof_token ?? '');
  const records = await resolveTxt(domain).catch(() => [] as string[][]);
  // A TXT record arrives as chunks that must be joined before comparing: a value longer than
  // 255 characters is split by the protocol itself, and a resolver hands back the pieces.
  const found = records.some((chunks) => chunks.join('').trim() === expected);

  if (!found) {
    await tx.query(
      `UPDATE sso_domains SET checked_at = now(), last_error = $3
        WHERE tenant_id = $1 AND domain = $2`,
      [tx.tenantId, domain, 'the TXT record was not found'],
    );
  } else {
    await tx.query(
      `UPDATE sso_domains
          SET verified_at = now(), proof_token = NULL, checked_at = now(), last_error = NULL
        WHERE tenant_id = $1 AND domain = $2`,
      [tx.tenantId, domain],
    );
  }

  const after = await listSsoDomains(tx);
  return after.find((entry) => entry.domain === domain) as SsoDomainRow;
}

/** Gives up a domain. Whoever owns it can claim it afterwards. */
export async function removeSsoDomain(tx: TenantTransaction, domain: string): Promise<void> {
  await tx.query(`DELETE FROM sso_domains WHERE tenant_id = $1 AND domain = $2`, [
    tx.tenantId,
    domain,
  ]);
}

/** What is configured now, for the screen that configures it. Never the client secret. */
export interface IdpView {
  issuer: string;
  clientId: string;
  /** That a secret is stored, never which one or where. */
  hasSecret: boolean;
  discoveryUrl: string;
  roleClaim: string;
  roleMap: Record<string, SsoRole>;
  defaultRole: SsoRole | null;
  allowJit: boolean;
  enforceSso: boolean;
  /** When the provider's endpoints were last read from its discovery document. */
  discoveredAt: Date | null;
}

export async function getIdp(tx: TenantTransaction): Promise<IdpView | null> {
  const { rows } = await tx.query<{
    issuer: string;
    client_id: string;
    client_secret_ref: string;
    discovery_url: string;
    role_claim: string;
    role_map: Record<string, SsoRole>;
    default_role: SsoRole | null;
    allow_jit: boolean;
    enforce_sso: boolean;
    discovered_at: Date | null;
  }>(
    `SELECT issuer, client_id, client_secret_ref, discovery_url, role_claim, role_map,
            default_role, allow_jit, enforce_sso, discovered_at
       FROM tenant_idp WHERE tenant_id = $1`,
    [tx.tenantId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    issuer: row.issuer,
    clientId: row.client_id,
    // The reference is deliberately not carried out of here: a pointer on a page is one
    // lookup from the secret it points at.
    hasSecret: row.client_secret_ref !== '',
    discoveryUrl: row.discovery_url,
    roleClaim: row.role_claim,
    roleMap: row.role_map,
    defaultRole: row.default_role,
    allowJit: row.allow_jit,
    enforceSso: row.enforce_sso,
    discoveredAt: row.discovered_at,
  };
}
