import { NextResponse, type NextRequest } from 'next/server';

/**
 * The content security policy of the console (SEC-03).
 *
 * A policy is written per request rather than in the configuration because the script
 * directive carries a nonce: a number used once, minted here, put on the request so the
 * framework stamps its own inline scripts with it, and named in the header so the browser
 * runs those and nothing else. An injected `<script>` has no nonce and does not run, which is
 * the whole point; a policy of `'unsafe-inline'` would run it.
 *
 * `strict-dynamic` lets a script the nonce allowed load the chunks it needs, which is how a
 * single page application loads its own code. Styles keep `'unsafe-inline'` because screens
 * set spacing through the `style` attribute from design tokens, and a browser cannot tell an
 * attribute written by us from one written by anybody else.
 *
 * Every origin in the policy is our own (ADR-139). The type face used to be fetched from a
 * font service, which put two hosts in the policy and made every employee's browser announce
 * itself to a third party to read a screen; it is served by us now, so a page that reaches
 * anywhere else is a page that has been tampered with.
 */

export function contentSecurityPolicy(nonce: string, development: boolean): string {
  return [
    `default-src 'self'`,
    // A development build compiles in the browser and needs eval for it; a deployment never does.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `font-src 'self'`,
    `img-src 'self' data:`,
    `connect-src 'self'`,
    // Nothing is embedded and nothing embeds us: no plugins, no frames, no clickjacking.
    `object-src 'none'`,
    `frame-src 'none'`,
    `frame-ancestors 'none'`,
    // A form on our screens posts to us, and `<base>` cannot be moved under an injected host.
    `form-action 'self'`,
    `base-uri 'self'`,
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/** A fresh nonce for one response: 128 bits, from the runtime's own source of randomness. */
function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function middleware(request: NextRequest): NextResponse {
  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV !== 'production');

  // The framework reads the nonce out of the policy on the request and stamps it on the
  // scripts it writes itself; `x-nonce` is for our own components to read it the same way.
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', policy);
  return response;
}

export const config = {
  /**
   * Every screen, and nothing that is already a file on disk: a nonce means a response cannot
   * be cached, and a policy on a font or an image protects nothing.
   */
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
