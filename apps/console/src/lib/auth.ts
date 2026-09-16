import { withTenant, type TenantTransaction } from '@nx-verify/db';
import {
  beginSso,
  completeSso,
  createSession,
  getPlatformSettings,
  issueLoginCode,
  login,
  redeemLoginCode,
  type HttpJson,
  type IssuedSession,
  type SsoFetcher,
  verifyPassword,
} from '@nx-verify/core';
import { getPool } from './context';

/**
 * Signing in, from the console's side.
 *
 * Two doors into the same session: a password, and the subscriber's own directory. Both
 * end at the one thing the rest of the console reads, a session cookie, so no screen
 * knows or cares which door a person came through.
 *
 * Everything here that can fail fails the same way. A wrong password, an unknown address,
 * a workspace that does not exist and a domain nobody routed all produce one message, so
 * the sign in screen cannot be used to find out who works where.
 */

export const SESSION_COOKIE = 'nx_session';

/** One message for every failure. The reason is ours to log, not the visitor's to read. */
export const SIGN_IN_FAILED = 'تعذّر تسجيل الدخول. تحقق من البيانات وحاول مرة أخرى.';

export interface SignedIn {
  token: string;
  expiresAt: Date;
}

const runInTenant = <T>(tenantId: string, handler: (tx: TenantTransaction) => Promise<T>) =>
  withTenant(getPool(), tenantId, handler);

export async function signInWithPassword(input: {
  slug: string;
  email: string;
  password: string;
  ip?: string | null;
}): Promise<SignedIn> {
  const result = await login(getPool(), (tenantId, handler) => runInTenant(tenantId, handler), {
    slug: input.slug.trim().toLowerCase(),
    email: input.email.trim(),
    password: input.password,
    ip: input.ip ?? null,
  });
  return toSignedIn(result.session);
}

/** The cookie that holds a sign in between the password and the code (ADR-143). */
export const PENDING_COOKIE = 'nx_pending';

/** How long the second step may be left unfinished. The code itself expires with it. */
export const PENDING_MINUTES = 10;

export interface PendingSignIn {
  tenantId: string;
  handle: string;
}

/**
 * The password half, and what to do next.
 *
 * `code` is returned exactly once, to be put in a message and forgotten: it is never stored
 * in a readable form and never comes back from anywhere.
 */
export type PasswordOutcome =
  | { step: 'signed-in'; signed: SignedIn }
  | {
      step: 'code';
      pending: PendingSignIn;
      code: string;
      to: string;
      toName: string | null;
      expiresAt: Date;
    };

export async function beginSignIn(input: {
  slug: string;
  email: string;
  password: string;
  ip?: string | null;
}): Promise<PasswordOutcome> {
  const slug = input.slug.trim().toLowerCase();
  const email = input.email.trim();
  const verified = await verifyPassword(getPool(), {
    slug,
    email,
    password: input.password,
    ip: input.ip ?? null,
  });

  const settings = await runInTenant(verified.tenantId, (tx) => getPlatformSettings(tx));
  if (settings.userSecondStep !== 'email') {
    const session = await runInTenant(verified.tenantId, (tx) =>
      createSession(tx, { userId: verified.userId, ip: input.ip ?? null }),
    );
    return { step: 'signed-in', signed: toSignedIn(session) };
  }

  const issued = await runInTenant(verified.tenantId, (tx) =>
    issueLoginCode(tx, { userId: verified.userId, ip: input.ip ?? null }),
  );
  return {
    step: 'code',
    pending: { tenantId: verified.tenantId, handle: issued.handle },
    code: issued.code,
    to: email,
    toName: verified.displayName,
    expiresAt: issued.expiresAt,
  };
}

/** Spends the code and mints the session the password alone did not. */
export async function finishSignIn(pending: PendingSignIn, code: string): Promise<SignedIn> {
  const session = await runInTenant(pending.tenantId, async (tx) => {
    const redeemed = await redeemLoginCode(tx, { handle: pending.handle, code });
    return createSession(tx, { userId: redeemed.userId });
  });
  return toSignedIn(session);
}

/**
 * The value the browser carries between the two steps.
 *
 * The handle is the secret and is random; the workspace rides along only so the second step
 * knows which one to look in, and a handle offered against the wrong workspace simply finds
 * nothing.
 */
export function pendingCookie(pending: PendingSignIn): {
  name: string;
  value: string;
  options: { httpOnly: true; sameSite: 'lax'; secure: boolean; path: string; expires: Date };
} {
  return {
    name: PENDING_COOKIE,
    value: `${pending.tenantId}.${pending.handle}`,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production',
      path: '/',
      expires: new Date(Date.now() + PENDING_MINUTES * 60_000),
    },
  };
}

/** Reads it back, refusing anything that is not the shape this wrote. */
export function readPending(value: string | undefined): PendingSignIn | null {
  if (value === undefined) {
    return null;
  }
  const at = value.indexOf('.');
  const tenantId = value.slice(0, at);
  const handle = value.slice(at + 1);
  if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !handle.startsWith('nxp_')) {
    return null;
  }
  return { tenantId, handle };
}

/**
 * The identity provider, over the network.
 *
 * The only place the console reaches outside itself. Kept behind the same interface the
 * tests drive, so what runs here is what was tested.
 */
export class FetchSsoClient implements SsoFetcher {
  async get(url: string): Promise<HttpJson> {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    return { status: response.status, body: await safeJson(response) };
  }

  async postForm(url: string, form: Record<string, string>): Promise<HttpJson> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
    });
    return { status: response.status, body: await safeJson(response) };
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function callbackUrl(): string {
  const base = process.env['NX_CONSOLE_URL'] ?? 'http://localhost:3001';
  return `${base.replace(/\/$/, '')}/sso/callback`;
}

export function startSso(email: string, fetcher: SsoFetcher = new FetchSsoClient()) {
  return beginSso(getPool(), runInTenant, {
    email,
    redirectUri: callbackUrl(),
    fetcher,
  });
}

export async function finishSso(
  input: { state: string; code: string; ip?: string | null },
  fetcher: SsoFetcher = new FetchSsoClient(),
  clientSecretFor: (ref: string) => Promise<string> = defaultClientSecret,
): Promise<SignedIn> {
  const result = await completeSso(getPool(), runInTenant, {
    state: input.state,
    code: input.code,
    fetcher,
    clientSecretFor,
    ip: input.ip ?? null,
  });
  return toSignedIn(result.session);
}

/** Rule 10: the row holds a reference, and the material comes from the store. */
async function defaultClientSecret(ref: string): Promise<string> {
  const { secretStoreFromEnv } = await import('@nx-verify/providers');
  const material = await secretStoreFromEnv().fetch(ref);
  const secret = material['clientSecret'] ?? material['client_secret'];
  if (!secret) {
    throw new Error('the stored material carries no client secret');
  }
  return secret;
}

function toSignedIn(session: IssuedSession): SignedIn {
  return { token: session.token, expiresAt: session.expiresAt };
}

/**
 * How the session cookie is set.
 *
 * httpOnly so a script on the page cannot read it, sameSite lax because the browser
 * arrives here as a top level redirect from the identity provider and a strict cookie
 * would not be sent, and secure everywhere except local development over plain http.
 */
export function sessionCookie(signed: SignedIn): {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: 'lax';
    secure: boolean;
    path: string;
    expires: Date;
  };
} {
  return {
    name: SESSION_COOKIE,
    value: signed.token,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production',
      path: '/',
      expires: signed.expiresAt,
    },
  };
}
