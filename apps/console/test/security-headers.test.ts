import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { contentSecurityPolicy, config, middleware } from '../src/middleware';
import nextConfig from '../next.config.mjs';

/**
 * The headers on every response from the console (SEC-03).
 *
 * The policy is the interesting one: a nonce minted per response is what lets the framework's
 * own inline scripts run while an injected one does not, and a nonce that repeated between
 * responses would be worth nothing.
 */

const request = (url = 'http://localhost:3000/dashboard'): NextRequest => new NextRequest(url);

describe('the console content security policy', () => {
  it('mints a fresh nonce for each response and names it in the policy', () => {
    const first = middleware(request()).headers.get('content-security-policy') ?? '';
    const second = middleware(request()).headers.get('content-security-policy') ?? '';
    const nonceOf = (policy: string) => /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
    expect(nonceOf(first)).toBeDefined();
    expect(nonceOf(first)).not.toBe(nonceOf(second));
    // 128 bits in base64.
    expect((nonceOf(first) ?? '').length).toBe(24);
  });

  it('runs no script it did not stamp, and allows no inline script at all', () => {
    const policy = contentSecurityPolicy('n0nce', false);
    expect(policy).toContain(`script-src 'self' 'nonce-n0nce' 'strict-dynamic'`);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-eval'/);
  });

  it('lets a development build compile in the browser, and a deployment never', () => {
    expect(contentSecurityPolicy('n0nce', true)).toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(contentSecurityPolicy('n0nce', true)).not.toContain('upgrade-insecure-requests');
    expect(contentSecurityPolicy('n0nce', false)).toContain('upgrade-insecure-requests');
  });

  it('allows the type faces, and nothing else from anywhere else', () => {
    const policy = contentSecurityPolicy('n0nce', false);
    expect(policy).toContain(`style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`);
    expect(policy).toContain(`font-src 'self' https://fonts.gstatic.com`);
    expect(policy).toContain(`connect-src 'self'`);
    expect(policy).toContain(`default-src 'self'`);
    // No screen is embedded anywhere, and none embeds anything.
    expect(policy).toContain(`frame-ancestors 'none'`);
    expect(policy).toContain(`frame-src 'none'`);
    expect(policy).toContain(`object-src 'none'`);
    expect(policy).toContain(`form-action 'self'`);
    expect(policy).toContain(`base-uri 'self'`);
  });

  it('passes the nonce to the framework on the request, not only to the browser', () => {
    const response = middleware(request());
    const policy = response.headers.get('content-security-policy') ?? '';
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    // The framework stamps its own inline scripts from the policy it is handed, so the same
    // policy travels inward as well as back to the browser.
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
  });

  it('is asked for on screens and not on files already on disk', () => {
    const source = config.matcher[0]?.source ?? '';
    expect(source).toContain('_next/static');
    expect(source).toContain('_next/image');
    expect(source).toContain('favicon.ico');
  });
});

describe('the headers that never change', () => {
  it('states them once, for every path', async () => {
    const rules = await (nextConfig.headers?.() ?? Promise.resolve([]));
    const rule = rules.find((entry) => entry.source === '/:path*');
    const headers = new Map(rule?.headers.map((header) => [header.key, header.value]));
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
    // Outside production there is no https to hold a browser to.
    expect(headers.has('Strict-Transport-Security')).toBe(false);
  });

  it('never names the framework in a header', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

describe('secrets never travel in an address (SEC-10)', () => {
  const root = fileURLToPath(new URL('../src', import.meta.url));

  const sources = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        return sources(path);
      }
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    });

  /**
   * A new API key, a new account's temporary password and a fresh share link are each shown
   * once. Carried in a redirect they would outlive the screen: the browser keeps the address
   * in its history, sends it as the referrer of the next request, and every proxy on the way
   * writes it down. Each comes back as the result of the action that made it instead.
   */
  it('puts no key, password, secret or share token into a redirect', () => {
    const offenders: string[] = [];
    for (const file of sources(root)) {
      const text = readFileSync(file, 'utf8');
      for (const [redirect] of text.matchAll(/redirect\(\s*`[^`]*`/g)) {
        if (/\$\{[^}]*\b(password|secret|token|key|issued|share)\b/i.test(redirect)) {
          offenders.push(`${file.slice(root.length + 1)}: ${redirect.slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reads none of them back out of a search parameter', () => {
    const offenders: string[] = [];
    for (const file of sources(root)) {
      const text = readFileSync(file, 'utf8');
      for (const [read] of text.matchAll(/params(?:_)?\[['"]([a-z_]+)['"]\]/gi)) {
        if (/password|secret|token|issued|share/i.test(read)) {
          offenders.push(`${file.slice(root.length + 1)}: ${read}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
