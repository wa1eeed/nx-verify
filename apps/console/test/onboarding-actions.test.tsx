import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpenCase, type JourneyView } from '../src/components/onboarding-open';
import {
  OnboardingCaseView,
  actionKeyLabel,
  type CaseDetailView,
  type CaseStepView,
} from '../src/components/onboarding-case';

/**
 * Opening an onboarding file, and carrying one forward (ADR-148).
 *
 * The list screen's primary action pointed at a route that did not exist, so the only way
 * into onboarding from this console was a 404, and the case screen could watch a file stuck
 * on a pending check without running it or setting it aside.
 *
 * The property worth pinning down on the case screen is which controls appear when: a closed
 * file offers nothing, and a waive is offered only on a check nobody has run.
 */

const noop = async (): Promise<void> => {};

const journey: JourneyView = {
  code: 'MERCHANT',
  nameAr: 'تأهيل تاجر',
  descriptionAr: 'السجل والعنوان والآيبان',
  stepCount: 3,
  slaHours: 48,
};

const step = (over: Partial<CaseStepView> = {}): CaseStepView => ({
  stepKey: 'registry',
  productNameAr: 'السجل التجاري',
  required: true,
  status: 'PENDING',
  runId: null,
  runReference: null,
  waiveReason: null,
  decidedAt: null,
  ...over,
});

const caseView = (over: Partial<CaseDetailView> = {}): CaseDetailView => ({
  caseId: 'c1',
  reference: 'ONB-2026-000002',
  journeyNameAr: 'تأهيل تاجر',
  entityId: null,
  entityName: null,
  status: 'IN_PROGRESS',
  outcome: null,
  clientRef: null,
  openedAt: new Date('2026-09-15T09:00:00Z'),
  dueAt: new Date('2026-09-17T09:00:00Z'),
  closedAt: null,
  overdue: false,
  steps: [step()],
  actions: [],
  ...over,
});

const renderCase = (props: Partial<Parameters<typeof OnboardingCaseView>[0]> = {}): string =>
  renderToStaticMarkup(
    <OnboardingCaseView view={caseView()} advanceAction={noop} waiveAction={noop} {...props} />,
  );

describe('opening a file', () => {
  const html = renderToStaticMarkup(<OpenCase journeys={[journey]} action={noop} />);

  it('asks for a journey and a number, and nothing else', () => {
    expect(html).toContain('name="journey"');
    expect(html).toContain('name="number"');
    // The checks read the applicant from the authorities themselves; asking for more here
    // would be asking a person to type what we are about to go and find out.
    expect(html).toContain('لا نطلب منك كتابة ما سنذهب لمعرفته');
  });

  it('says what each journey costs in checks and in time', () => {
    expect(html).toContain('3 فحوص');
    expect(html).toContain('48 ساعة');
  });

  it('says so plainly when the platform has configured no journey', () => {
    const empty = renderToStaticMarkup(<OpenCase journeys={[]} action={noop} />);
    expect(empty).toContain('data-role="empty-state"');
    expect(empty).not.toContain('data-role="open-case-submit"');
  });
});

describe('working a file', () => {
  it('offers to run what is still pending', () => {
    const html = renderCase();
    expect(html).toContain('data-role="advance-case"');
    expect(html).toContain('data-role="advance-submit"');
    // The number is asked for every time rather than kept on the case: a case that stored
    // identifiers would be the one table in this platform that keeps them in the clear.
    expect(html).toContain('القاعدة 4');
  });

  it('offers a waive only on a check nobody has run, and only from the closed set', () => {
    const html = renderCase();
    expect(html).toContain('data-role="waive-step"');
    expect(html).toContain('ALREADY_VERIFIED_ELSEWHERE');
    expect(html).toContain('RISK_ACCEPTED');

    const done = renderCase({
      view: caseView({ steps: [step({ status: 'DONE', runId: 'r1', runReference: 'VR-1' })] }),
    });
    expect(done).not.toContain('data-role="waive-step"');
  });

  it('offers nothing at all once everything has run', () => {
    const html = renderCase({
      view: caseView({ steps: [step({ status: 'DONE', runId: 'r1' })], status: 'IN_REVIEW' }),
    });
    expect(html).not.toContain('data-role="advance-case"');
  });

  it('offers nothing on a closed file', () => {
    const html = renderCase({
      view: caseView({ status: 'CLOSED', closedAt: new Date('2026-09-16T09:00:00Z') }),
    });
    expect(html).not.toContain('data-role="advance-case"');
  });

  it('reads as a report where no action is passed in', () => {
    const html = renderToStaticMarkup(<OnboardingCaseView view={caseView()} />);
    expect(html).not.toContain('data-role="advance-case"');
    expect(html).not.toContain('data-role="waive-step"');
  });

  it('says what the last action did', () => {
    expect(renderCase({ outcome: 'waived' })).toContain('data-tone="done"');
    expect(renderCase({ outcome: 'closed' })).toContain('data-tone="refused"');
  });
});

/**
 * What the decision set off, and where a destination comes from (ADR-182).
 *
 * The panel used to explain an empty list with «لا إجراءات معرّفة لهذه الرحلة», which reads
 * as a setting left empty and was nothing of the kind: the table it named is written by
 * provisioning and by no screen in this console. What a subscriber controls is the
 * subscription, and a decision now goes there, so the sentence has to point at that door
 * and at no other.
 */
describe('what a decision set off', () => {
  const decided = (actions: CaseDetailView['actions'] = []): string =>
    renderCase({
      view: caseView({
        status: 'APPROVED',
        outcome: 'PASS',
        closedAt: new Date('2026-09-16T09:00:00Z'),
        steps: [step({ status: 'DONE', runId: 'r1', runReference: 'VR-1' })],
        actions,
      }),
    });

  it('sends nobody looking for a screen that does not exist', () => {
    const html = decided();
    expect(html).toContain('data-role="no-actions"');
    expect(html).not.toContain('لا إجراءات معرّفة');
  });

  it('names the two places a destination is actually set, and links to them', () => {
    const html = decided();
    expect(html).toContain('href="/settings/developers/webhooks"');
    expect(html).toContain('href="/settings/notifications"');
    // Nothing fired is still not a fault, and the file says which of the two it was.
    expect(html).toContain('هذا ليس عطلاً');
  });

  it('promises nothing about a file nobody has decided yet', () => {
    const html = renderCase();
    expect(html).toContain('لم يُتخذ قرار بعد');
    expect(html).not.toContain('href="/settings/developers/webhooks"');
  });

  it('does not call a file in review undecided because it carries no verdict', () => {
    // A required check that failed sends the file to a person and leaves `outcome` null,
    // which is three of the four ways a file reaches review. `onboarding.review` went out
    // at that moment, so «لم يُتخذ قرار بعد» is the wrong half of the panel: the reason
    // nothing is listed is that nobody was subscribed.
    const html = renderCase({
      view: caseView({
        status: 'IN_REVIEW',
        outcome: null,
        steps: [step({ status: 'FAILED', runId: 'r1', runReference: 'VR-1' })],
      }),
    });

    expect(html).not.toContain('لم يُتخذ قرار بعد');
    expect(html).toContain('href="/settings/developers/webhooks"');
    expect(html).toContain('href="/settings/notifications"');
  });

  it('does not tell the owner of a withdrawn file to go and set a destination', () => {
    // Nothing fired because nobody decided anything, and pointing at the webhooks screen
    // would promise that subscribing changes it.
    const html = renderCase({
      view: caseView({
        status: 'WITHDRAWN',
        outcome: null,
        closedAt: new Date('2026-09-16T09:00:00Z'),
      }),
    });

    expect(html).toContain('سُحب هذا الملف');
    expect(html).not.toContain('href="/settings/developers/webhooks"');
  });

  it('says in words that a firing followed a subscription, rather than printing its key', () => {
    const html = decided([
      {
        actionKey: 'subscription',
        actionType: 'WEBHOOK',
        outcome: 'APPROVED',
        delivered: true,
        at: new Date('2026-09-16T09:00:00Z'),
      },
      {
        actionKey: 'subscription',
        actionType: 'NOTIFY',
        outcome: 'APPROVED',
        delivered: true,
        at: new Date('2026-09-16T09:00:00Z'),
      },
    ]);

    expect(html).toContain('اشتراككم في هذا الحدث');
    expect(html).toContain('نداء نظامكم');
    expect(html).toContain('تنبيه');
    expect(html).not.toContain('data-role="no-actions"');
    expect(actionKeyLabel('activate')).toBe('activate');
  });
});
