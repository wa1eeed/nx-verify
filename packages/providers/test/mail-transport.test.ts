import { describe, expect, it } from 'vitest';
import { ResendMailTransport } from '../src/mail/transport.js';

/**
 * The Resend adapter (ADR-141).
 *
 * Exercised against recorded answers with `fetch` injected, like every other adapter in this
 * package: the whole thing is proven without an account, and pointing it at a live one is
 * configuration.
 *
 * Two of these are about what must never leave. A mail service that echoes a recipient back
 * inside an error would otherwise put an address into our logs (rule 4), and a sweep retried
 * after a timeout would otherwise put the same message into somebody's inbox twice (rule 7).
 */

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface Answer {
  status: number;
  body?: unknown;
}

function recording(answer: Answer | (() => never)): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    if (typeof answer === 'function') {
      answer();
      throw new Error('unreachable');
    }
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status });
  }) as unknown as typeof fetch;
  return { fetch: fake, calls };
}

const message = {
  to: 'person@example.sa',
  toName: 'قارئ',
  subject: 'تنبيه',
  body: 'سطر أول\n\nسطر ثانٍ',
};

describe('sending through Resend', () => {
  it('posts the message to the service, from the address the settings name', async () => {
    const recorder = recording({ status: 200, body: { id: 'msg-1' } });
    const transport = new ResendMailTransport({
      key: 'test-key',
      from: 'NX Trust <no-reply@nx.sa>',
      replyTo: 'support@nx.sa',
      fetch: recorder.fetch,
    });

    expect(await transport.send(message)).toEqual({ ok: true });

    const call = recorder.calls[0];
    expect(call?.url).toBe(ResendMailTransport.ENDPOINT);
    expect(call?.headers['authorization']).toBe('Bearer test-key');
    expect(call?.body['from']).toBe('NX Trust <no-reply@nx.sa>');
    expect(call?.body['to']).toEqual(['person@example.sa']);
    expect(call?.body['reply_to']).toBe('support@nx.sa');
  });

  it('sends the Arabic body as text and as a right to left document', async () => {
    const recorder = recording({ status: 200 });
    const transport = new ResendMailTransport({
      key: 'k',
      from: 'a@b.sa',
      fetch: recorder.fetch,
    });
    await transport.send(message);

    const body = recorder.calls[0]?.body ?? {};
    expect(body['text']).toBe('سطر أول\n\nسطر ثانٍ');
    // A mail client left to itself lays Arabic out left to right and runs the paragraphs
    // together, so the wrapper says the direction and keeps the break.
    expect(String(body['html'])).toContain('dir="rtl"');
    expect(String(body['html'])).toContain('<p style="margin:0 0 12px">سطر أول</p>');
  });

  it('escapes a body that contains markup rather than sending it as markup', async () => {
    const recorder = recording({ status: 200 });
    const transport = new ResendMailTransport({ key: 'k', from: 'a@b.sa', fetch: recorder.fetch });
    await transport.send({ ...message, body: 'اضغط <script>alert(1)</script>' });
    expect(String(recorder.calls[0]?.body['html'])).toContain('&lt;script&gt;');
    expect(String(recorder.calls[0]?.body['html'])).not.toContain('<script>');
  });

  it('carries an idempotency key, so a retried sweep is one message', async () => {
    const recorder = recording({ status: 200 });
    const transport = new ResendMailTransport({ key: 'k', from: 'a@b.sa', fetch: recorder.fetch });
    await transport.send({ ...message, idempotencyKey: 'delivery-7' });
    expect(recorder.calls[0]?.headers['idempotency-key']).toBe('delivery-7');
  });

  it('reports the status of a refusal and never what the service said back', async () => {
    const recorder = recording({
      status: 422,
      body: { message: 'person@example.sa is not a valid address' },
    });
    const transport = new ResendMailTransport({ key: 'k', from: 'a@b.sa', fetch: recorder.fetch });
    const result = await transport.send(message);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('resend answered 422');
    // The recipient came back inside the service's own error. It does not come back out of
    // ours (rule 4).
    expect(result.error).not.toContain('example.sa');
  });

  it('calls a service that will not answer a failure, not an exception', async () => {
    const recorder = recording(() => {
      throw new Error('getaddrinfo ENOTFOUND api.resend.com');
    });
    const transport = new ResendMailTransport({ key: 'k', from: 'a@b.sa', fetch: recorder.fetch });
    // The job loop records failures and retries them; a transport that throws would take the
    // whole sweep with it.
    expect(await transport.send(message)).toEqual({ ok: false, error: 'resend unreachable' });
  });
});
