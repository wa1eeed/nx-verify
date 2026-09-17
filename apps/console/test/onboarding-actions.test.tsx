import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpenCase, type JourneyView } from '../src/components/onboarding-open';
import {
  OnboardingCaseView,
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
  seq: 1,
  productNameAr: 'السجل التجاري',
  productCode: 'CR_STATUS',
  required: true,
  status: 'PENDING',
  runId: null,
  runReference: null,
  waiveReason: null,
  ...over,
});

const caseView = (over: Partial<CaseDetailView> = {}): CaseDetailView => ({
  caseId: 'c1',
  reference: 'ONB-2026-000002',
  journeyCode: 'MERCHANT',
  journeyNameAr: 'تأهيل تاجر',
  entityId: null,
  entityName: null,
  status: 'IN_PROGRESS',
  outcome: null,
  openedAt: new Date('2026-09-15T09:00:00Z'),
  dueAt: new Date('2026-09-17T09:00:00Z'),
  closedAt: null,
  steps: [step()],
  actions: [],
  ...over,
});

const renderCase = (props: Partial<Parameters<typeof OnboardingCaseView>[0]> = {}): string =>
  renderToStaticMarkup(
    <OnboardingCaseView
      view={caseView()}
      advanceAction={noop}
      waiveAction={noop}
      {...props}
    />,
  );

describe('opening a file', () => {
  const html = renderToStaticMarkup(
    <OpenCase journeys={[journey]} action={noop} />,
  );

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
