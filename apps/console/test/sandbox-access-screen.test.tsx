import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MadeSandbox,
  PendingSandboxes,
  SandboxAccess,
  NO_SANDBOX_ANSWER,
  type PendingSandboxView,
  type SandboxAccessView,
  type SandboxAnswerState,
} from '../src/components/sandbox-access';

/**
 * ADR-173: the subscriber has a way to ask for a sandbox, and the panel has a way to answer.
 *
 * What these assert is mostly what the screens do not say. The old screen offered «اطلب مساحة
 * اختبار» as a link to the support page and told the reader they would enter the sandbox «بنفس
 * بريدك», which was a promise nothing kept. So each state here is checked for saying only what
 * is true of it: waiting says it waits and why, ready names the workspace, and a request that
 * cannot be granted is not given a button that could only fail.
 */

const EM_DASH = String.fromCharCode(0x2014);

/** The action the rendered forms never run: these tests read markup, not behaviour. */
const noAnswer = async (): Promise<SandboxAnswerState> => NO_SANDBOX_ANSWER;
const noop = async (): Promise<void> => {};

function card(view: Partial<SandboxAccessView> = {}): string {
  const full: SandboxAccessView = {
    status: 'NONE',
    requestedAt: null,
    decidedAt: null,
    sandboxSlug: null,
    refusalCode: null,
    canAsk: true,
    ...view,
  };
  return renderToStaticMarkup(<SandboxAccess view={full} requestAction={noop} />);
}

describe('the subscriber card for a sandbox', () => {
  it('offers the ask itself rather than a page about asking', () => {
    const html = card();
    expect(html).toContain('data-role="request-sandbox"');
    expect(html).toContain('اطلب مساحة اختبار');
    // The old path. Nothing on this card sends anybody to a form about a sandbox.
    expect(html).not.toContain('/settings/support');
    expect(html).not.toContain(EM_DASH);
  });

  it('says what the ask needs when the person cannot make it', () => {
    const html = card({ canAsk: false });
    expect(html).toContain('data-role="sandbox-needs-capability"');
    expect(html).not.toContain('data-role="request-sandbox"');
  });

  it('says it is waiting, and why it waits on a person', () => {
    const html = card({ status: 'REQUESTED', requestedAt: new Date('2026-09-19T08:00:00Z') });
    expect(html).toContain('بانتظار الإنشاء');
    expect(html).toContain('data-role="sandbox-waiting">');
    expect(html).toContain('2026-09-19');
    // Nothing to press while it waits: a second press is not a second sandbox.
    expect(html).not.toContain('data-role="request-sandbox"');
  });

  it('names the workspace once there is one, and how entry actually works', () => {
    const html = card({
      status: 'CREATED',
      requestedAt: new Date('2026-09-19T08:00:00Z'),
      decidedAt: new Date('2026-09-19T09:00:00Z'),
      sandboxSlug: 'acme-sandbox',
    });
    expect(html).toContain('data-role="sandbox-ready"');
    expect(html).toContain('acme-sandbox');
    expect(html).toContain('dir="ltr"');
    // The first password is handed over by us, which is what happens. The screen no longer
    // says a person simply signs in with the same address and nothing else.
    expect(html).toContain('كلمة مرور أولى');
    expect(html).not.toContain('data-role="request-sandbox"');
  });

  it('gives a refusal a reason a reader can act on, and lets them ask again', () => {
    const html = card({ status: 'REFUSED', refusalCode: 'HAS_SANDBOX' });
    expect(html).toContain('data-role="sandbox-refusal"');
    expect(html).toContain('مساحة اختبار بالفعل');
    expect(html).toContain('اطلبها مرة أخرى');
  });

  it('reports a press that recorded nothing', () => {
    const html = card({ refusalAr: 'لم يُسجَّل طلب جديد.' });
    expect(html).toContain('data-role="sandbox-request-refused"');
    expect(html).toContain('لم يُسجَّل طلب جديد.');
  });
});

const ASK: PendingSandboxView = {
  id: '5f2a1c4e-0000-4000-8000-000000000001',
  tenantName: 'شركة المثال للتجارة',
  tenantSlug: 'acme',
  requestedAt: new Date('2026-09-19T08:00:00Z'),
  alreadyHasSandbox: false,
};

describe('the panel queue of asks', () => {
  it('says the queue is empty rather than showing an empty table', () => {
    const html = renderToStaticMarkup(<PendingSandboxes pending={[]} answerAction={noAnswer} />);
    expect(html).toContain('data-role="no-pending-sandboxes"');
  });

  it('offers one press to make it, and a second step to close it instead', () => {
    const html = renderToStaticMarkup(<PendingSandboxes pending={[ASK]} answerAction={noAnswer} />);
    expect(html).toContain('شركة المثال للتجارة');
    expect(html).toContain('data-role="create-sandbox"');
    // Refusing is the two step pattern: the consequence above the control that causes it.
    expect(html).toContain('data-role="refuse-sandbox"');
    expect(html).toContain('يُغلق الطلب ولا تُنشأ مساحة');
    expect(html).not.toContain(EM_DASH);
  });

  it('offers no button that could only fail', () => {
    const html = renderToStaticMarkup(
      <PendingSandboxes pending={[{ ...ASK, alreadyHasSandbox: true }]} answerAction={noAnswer} />,
    );
    // One sandbox per workspace is a unique index, not a preference, so «أنشئ» is not offered.
    expect(html).not.toContain('data-role="create-sandbox"');
    expect(html).toContain('data-role="sandbox-already"');
    expect(html).toContain('data-role="close-sandbox-request"');
  });
});

describe('the one time the first password exists', () => {
  it('shows it once, beside what it is for and what happens to it', () => {
    const html = renderToStaticMarkup(
      <MadeSandbox
        made={{
          legalName: 'شركة المثال للتجارة (Sandbox)',
          slug: 'acme-sandbox',
          email: 'dev@acme.sa',
          temporaryPassword: 'a-temporary-value',
        }}
      />,
    );
    expect(html).toContain('data-role="sandbox-temporary-password"');
    expect(html).toContain('a-temporary-value');
    expect(html).toContain('لن تُعرض مرة أخرى');
  });

  it('says plainly when no account was made, instead of implying one was', () => {
    const html = renderToStaticMarkup(
      <MadeSandbox
        made={{
          legalName: 'شركة المثال للتجارة (Sandbox)',
          slug: 'acme-sandbox',
          email: null,
          temporaryPassword: null,
        }}
      />,
    );
    expect(html).toContain('data-role="sandbox-without-account"');
    expect(html).not.toContain('data-role="sandbox-temporary-password"');
  });
});
