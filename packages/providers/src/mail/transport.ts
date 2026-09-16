/**
 * How mail leaves a deployment.
 *
 * An adapter to something outside us, so it lives here beside the verification providers and
 * the secret stores rather than inside the worker that happens to call it first: the panel
 * sends a test message through the same class the worker delivers with, and a transport only
 * one caller can reach is one only one caller can prove works.
 *
 * `fetch` is injected for the reason every adapter here injects it: the whole thing is
 * exercised against recorded answers, and pointing it at a live account is configuration.
 */

export interface OutgoingMail {
  to: string;
  toName: string | null;
  subject: string;
  body: string;
  /** The same message twice is one message. Carried to services that honour it. */
  idempotencyKey?: string | undefined;
}

export interface MailTransport {
  send(mail: OutgoingMail): Promise<{ ok: boolean; error?: string }>;
}

/** For local work and tests. Keeps what it was asked to send and sends nothing. */
export class CollectingMailTransport implements MailTransport {
  readonly sent: OutgoingMail[] = [];

  send(mail: OutgoingMail): Promise<{ ok: boolean }> {
    this.sent.push(mail);
    return Promise.resolve({ ok: true });
  }
}

/**
 * Mail over an HTTP API.
 *
 * The one transport shipped here, because it needs no dependency and every hosted mail
 * service offers one. SMTP needs a client library and a relay, and both are deployment
 * choices rather than product ones, so an SMTP transport implements this same interface
 * wherever a deployment wants it.
 *
 * The endpoint and the token come from the environment of the process, never from the
 * database (rule 10).
 */
export class HttpMailTransport implements MailTransport {
  readonly #endpoint: string;
  readonly #token: string;
  readonly #from: string;

  constructor(options: { endpoint: string; token: string; from: string }) {
    this.#endpoint = options.endpoint;
    this.#token = options.token;
    this.#from = options.from;
  }

  static fromEnv(): HttpMailTransport {
    const endpoint = process.env['NX_MAIL_ENDPOINT'];
    const token = process.env['NX_MAIL_TOKEN'];
    const from = process.env['NX_MAIL_FROM'];
    if (!endpoint || !token || !from) {
      throw new Error('NX_MAIL_ENDPOINT, NX_MAIL_TOKEN and NX_MAIL_FROM are required');
    }
    return new HttpMailTransport({ endpoint, token, from });
  }

  async send(mail: OutgoingMail): Promise<{ ok: boolean; error?: string }> {
    const response = await fetch(this.#endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.#from,
        to: mail.to,
        to_name: mail.toName,
        subject: mail.subject,
        text: mail.body,
      }),
    });

    if (response.ok) {
      return { ok: true };
    }
    // The status, not the body. A mail service that echoes the recipient back in an error
    // would otherwise put it in our logs.
    return { ok: false, error: `mail endpoint answered ${response.status}` };
  }
}

/**
 * Resend, the hosted mail service.
 *
 * One endpoint and a bearer key, like every other adapter here, and `fetch` is injected for
 * the same reason the verification providers inject it: the whole adapter is exercised against
 * recorded answers and pointing it at a live account is configuration, not a code change.
 *
 * Two things it does that the generic transport does not. It sends the message as HTML as well
 * as text, because a notification that arrives as a wall of unformatted Arabic is one nobody
 * reads. And it carries an idempotency key, so a sweep that is retried after a timeout cannot
 * send the same message twice: rule 7 is about what a caller is charged, and a person's inbox
 * is a stricter version of the same rule.
 */
export class ResendMailTransport implements MailTransport {
  static readonly ENDPOINT = 'https://api.resend.com/emails';

  readonly #key: string;
  readonly #from: string;
  readonly #replyTo: string | null;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: {
    key: string;
    /** Either «name <address>» or a bare address. Built by the caller from the settings. */
    from: string;
    replyTo?: string | null;
    fetch?: typeof fetch;
    timeoutMs?: number;
  }) {
    this.#key = options.key;
    this.#from = options.from;
    this.#replyTo = options.replyTo ?? null;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  async send(mail: OutgoingMail): Promise<{ ok: boolean; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(ResendMailTransport.ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.#key}`,
          'content-type': 'application/json',
          ...(mail.idempotencyKey === undefined ? {} : { 'idempotency-key': mail.idempotencyKey }),
        },
        body: JSON.stringify({
          from: this.#from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.body,
          html: htmlOf(mail.body),
          ...(this.#replyTo === null ? {} : { reply_to: this.#replyTo }),
        }),
      });

      if (response.ok) {
        return { ok: true };
      }
      // The status, not the body. A mail service that echoes the recipient back in an error
      // would otherwise put it in our logs (rule 4).
      return { ok: false, error: `resend answered ${response.status}` };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error && error.name === 'AbortError'
            ? 'resend timed out'
            : 'resend unreachable',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * The body as a right to left HTML document.
 *
 * The queue holds Arabic plain text, and a mail client left to itself lays Arabic out left to
 * right and runs the paragraphs together. This is the smallest wrapper that fixes both, with
 * no styling beyond direction and a readable line length: a notification is not a screen.
 */
function htmlOf(body: string): string {
  const escaped = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 12px">${block.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<!doctype html><html dir="rtl" lang="ar"><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.7;max-width:36em">${paragraphs}</body></html>`;
}
