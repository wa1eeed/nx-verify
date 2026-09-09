import { createSign, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import type { HttpJson, SsoFetcher } from '../../packages/core/src/auth/sso.js';

/**
 * An identity provider, in memory, speaking the real protocol.
 *
 * It signs identity tokens with a real RSA key and publishes a real key set, so the
 * verification under test is the verification that runs in production. The only thing
 * missing is the network, and the network is not what any of these tests are about.
 */

export interface FakeIdpOptions {
  issuer?: string;
  clientId?: string;
}

export interface MintOptions {
  subject?: string;
  email?: string;
  name?: string;
  groups?: string[];
  nonce?: string | null;
  audience?: string | string[];
  issuer?: string;
  expiresInSeconds?: number;
  issuedAtOffsetSeconds?: number;
  algorithm?: string;
  /** Sign with a different key, to prove a forged token is refused. */
  key?: KeyObject;
  kid?: string;
}

export class FakeIdp implements SsoFetcher {
  readonly issuer: string;
  readonly clientId: string;
  readonly discoveryUrl: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly kid = 'test-key-1';

  readonly #privateKey: KeyObject;
  readonly #publicKey: KeyObject;
  readonly #codes = new Map<string, string>();

  /** Every form the platform posted, so a test can assert what was sent. */
  readonly tokenRequests: Record<string, string>[] = [];
  /** Set to answer discovery with something other than the truth. */
  discoveryOverride: Record<string, unknown> | null = null;

  constructor(options: FakeIdpOptions = {}) {
    this.issuer = options.issuer ?? 'https://idp.example.com';
    this.clientId = options.clientId ?? 'nx-verify-console';
    this.discoveryUrl = `${this.issuer}/.well-known/openid-configuration`;
    this.authorizationEndpoint = `${this.issuer}/authorize`;
    this.tokenEndpoint = `${this.issuer}/token`;
    this.jwksUri = `${this.issuer}/jwks`;

    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.#privateKey = pair.privateKey;
    this.#publicKey = pair.publicKey;
  }

  get(url: string): Promise<HttpJson> {
    if (url === this.discoveryUrl) {
      return Promise.resolve({
        status: 200,
        body: this.discoveryOverride ?? {
          issuer: this.issuer,
          authorization_endpoint: this.authorizationEndpoint,
          token_endpoint: this.tokenEndpoint,
          jwks_uri: this.jwksUri,
        },
      });
    }
    if (url === this.jwksUri) {
      const jwk = this.#publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
      return Promise.resolve({
        status: 200,
        body: { keys: [{ ...jwk, kid: this.kid, alg: 'RS256', use: 'sig' }] },
      });
    }
    return Promise.resolve({ status: 404, body: { error: 'not found' } });
  }

  postForm(url: string, form: Record<string, string>): Promise<HttpJson> {
    this.tokenRequests.push(form);
    if (url !== this.tokenEndpoint) {
      return Promise.resolve({ status: 404, body: { error: 'not found' } });
    }
    const idToken = this.#codes.get(form['code'] ?? '');
    if (!idToken) {
      return Promise.resolve({ status: 400, body: { error: 'invalid_grant' } });
    }
    this.#codes.delete(form['code'] ?? '');
    return Promise.resolve({
      status: 200,
      body: { id_token: idToken, token_type: 'Bearer', expires_in: 3600 },
    });
  }

  /** The person signs in at the provider: reads the redirect, returns an auth code. */
  authorize(authorizationUrl: string, options: MintOptions = {}): string {
    const url = new URL(authorizationUrl);
    const nonce = url.searchParams.get('nonce');
    const token = this.mint({
      ...options,
      ...(options.nonce === undefined ? { nonce } : {}),
    });
    const code = randomUUID();
    this.#codes.set(code, token);
    return code;
  }

  mint(options: MintOptions = {}): string {
    const now = Math.floor(Date.now() / 1000);
    const header = {
      alg: options.algorithm ?? 'RS256',
      typ: 'JWT',
      kid: options.kid ?? this.kid,
    };
    const payload: Record<string, unknown> = {
      iss: options.issuer ?? this.issuer,
      sub: options.subject ?? 'idp-subject-1',
      aud: options.audience ?? this.clientId,
      iat: now + (options.issuedAtOffsetSeconds ?? 0),
      exp: now + (options.expiresInSeconds ?? 300),
      ...(options.nonce === null ? {} : { nonce: options.nonce }),
      ...(options.email === undefined ? {} : { email: options.email }),
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(options.groups === undefined ? {} : { groups: options.groups }),
    };

    const signingInput = `${encode(header)}.${encode(payload)}`;
    const signature = createSign('RSA-SHA256')
      .update(signingInput)
      .sign(options.key ?? this.#privateKey);
    return `${signingInput}.${signature.toString('base64url')}`;
  }

  /** A token whose payload was edited after signing. */
  tamper(idToken: string, patch: Record<string, unknown>): string {
    const [header, payload, signature] = idToken.split('.') as [string, string, string];
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    return `${header}.${encode({ ...claims, ...patch })}.${signature}`;
  }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
