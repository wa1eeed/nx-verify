import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FieldGroup } from '@nx-verify/core';
import { isAddress, shareMail } from '../src/lib/share-mail';
import { SharePanel } from '../src/components/share-panel';
import { ShareOutcome, type IssuedShareState } from '../src/components/issued-once';

/**
 * Sending a customer's file to somebody outside the workspace (ADR-144).
 *
 * The properties worth pinning down are the ones that make a mailed link different from a
 * copied one. The message names what is being opened and when it stops working, so nobody
 * forwards a link they think is permanent. No identifier appears in it, because a mail is the
 * least private surface this platform touches. And once a link has left by mail the screen
 * does not print it too: two copies of a one-time link is one copy too many.
 */

const GROUPS: FieldGroup[] = ['REGISTRY', 'BANKING'];

const input = {
  customerName: 'شركة الأفق للتجارة',
  senderName: 'بنك النخيل',
  groups: GROUPS,
  link: 'https://trust.example.sa/p/tok_abc123',
  expiresAt: new Date('2026-10-17T09:00:00Z'),
  purpose: 'فتح حساب',
};

describe('the message that carries a shared file', () => {
  it('names the customer, the sender, what opens and when it stops', () => {
    const mail = shareMail(input);
    expect(mail.subject).toContain('شركة الأفق للتجارة');
    expect(mail.subject).toContain('بنك النخيل');
    expect(mail.body).toContain('السجل التجاري');
    expect(mail.body).toContain('الحسابات البنكية');
    expect(mail.body).toContain('فتح حساب');
    // The date it dies, spelled out. A link whose end is a surprise is a link somebody
    // keeps forwarding.
    expect(mail.body).toContain('17 أكتوبر 2026');
    expect(mail.body).toContain(input.link);
  });

  it('leaves the purpose out when there is none, rather than writing an empty line', () => {
    const mail = shareMail({ ...input, purpose: null });
    expect(mail.body).not.toContain('الغرض');
  });

  it('accepts an address a person types, and refuses what is not one', () => {
    expect(isAddress('bank@example.com')).toBe(true);
    expect(isAddress('  first.last+tag@sub.example.sa ')).toBe(true);
    expect(isAddress('bank@example')).toBe(false);
    expect(isAddress('bank at example.com')).toBe(false);
    expect(isAddress('a@b.c, d@e.f')).toBe(false);
    expect(isAddress('')).toBe(false);
    expect(isAddress(`${'x'.repeat(250)}@example.com`)).toBe(false);
  });
});

describe('what the screen says afterwards', () => {
  const outcome = (state: Partial<IssuedShareState>): string =>
    renderToStaticMarkup(
      <ShareOutcome state={{ link: null, sentTo: null, refused: null, ...state }} />,
    );

  it('names the address it went to, and does not print the link beside it', () => {
    const html = outcome({ sentTo: 'bank@example.com' });
    expect(html).toContain('bank@example.com');
    expect(html).toContain('data-role="share-sent"');
    expect(html).not.toContain('/p/');
  });

  it('says a failed send withdrew the link, so nothing is left live that nobody holds', () => {
    const html = outcome({ refused: 'mail' });
    expect(html).toContain('data-role="share-refused"');
    expect(html).toContain('سُحب الرابط');
  });

  it('shows nothing at all when a link was simply issued to the screen', () => {
    expect(outcome({ link: 'https://x/p/tok' })).toBe('');
  });
});

describe('the panel that offers it', () => {
  const html = renderToStaticMarkup(
    <SharePanel
      entityId="11111111-1111-1111-1111-111111111111"
      availableGroups={GROUPS}
      shares={[]}
      createAction={async () => ({ link: null, sentTo: null, refused: null })}
      revokeAction={() => {}}
    />,
  );

  it('offers an address, and leaves it empty so copying stays the default', () => {
    expect(html).toContain('name="recipient"');
    // No value attribute on it: an address that arrives prefilled is an address somebody
    // sends to without reading.
    expect(html).not.toMatch(/name="recipient"[^>]*value=/);
  });

  it('tells the subscriber the recipient is recorded, because it is', () => {
    expect(html).toContain('سُجّل المستلم في سجل التدقيق');
  });

  it('still ticks no group by default', () => {
    expect(html).not.toContain('checked');
  });
});
