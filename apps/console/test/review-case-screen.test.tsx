import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewCase, type ReviewCaseView } from '../src/components/review-case';
import { Monitoring } from '../src/components/monitoring';
import { FreshnessSettings } from '../src/components/freshness-settings';
import { fieldLabel } from '../src/components/field-card';

/**
 * Working a review case, and closing a detected change (ADR-146).
 *
 * Both screens existed and neither could do anything. The properties worth pinning down are
 * the ones that made them worth building: a case can be decided and approved from here, the
 * four eyes rule is **stated** rather than hidden, and a change can be closed so the number a
 * subscriber sees can go down as well as up.
 */

const noop = async (): Promise<void> => {};

const VIEWER = '11111111-1111-1111-1111-111111111111';
const COLLEAGUE = '22222222-2222-2222-2222-222222222222';

const caseView = (over: Partial<ReviewCaseView> = {}): ReviewCaseView => ({
  caseId: 'c1',
  entityId: 'e1',
  entityName: 'مؤسسة نماء',
  status: 'OPEN',
  reasonCodes: ['CR_NOT_ACTIVE'],
  priority: 'NORMAL',
  assignedTo: null,
  assignedToName: null,
  outcome: null,
  decidedBy: null,
  decidedByName: null,
  decisionNote: null,
  openedAt: new Date('2026-09-10T09:00:00Z'),
  slaDueAt: new Date('2026-09-17T09:00:00Z'),
  ageHours: 40,
  overdue: false,
  ...over,
});

const render = (props: Partial<Parameters<typeof ReviewCase>[0]> = {}): string =>
  renderToStaticMarkup(
    <ReviewCase
      item={caseView()}
      viewerId={VIEWER}
      canDecide
      canApprove
      assignAction={noop}
      decideAction={noop}
      approveAction={noop}
      returnAction={noop}
      {...props}
    />,
  );

describe('the review case screen', () => {
  it('offers the decision with a reason box, because a decision needs one', () => {
    const html = render();
    expect(html).toContain('data-role="case-decide"');
    expect(html).toContain('name="note"');
    expect(html).toContain('required');
    expect(html).toContain('data-role="decide-pass"');
    expect(html).toContain('data-role="decide-fail"');
  });

  it('offers no decision to a role that may not make one', () => {
    expect(render({ canDecide: false })).not.toContain('data-role="case-decide"');
  });

  it('lets somebody else approve a decision that is waiting', () => {
    const html = render({
      item: caseView({
        status: 'DECIDED',
        outcome: 'PASS',
        decidedBy: COLLEAGUE,
        decisionNote: 'السجل نشط',
      }),
    });
    expect(html).toContain('data-role="approve-case"');
    expect(html).toContain('data-role="return-case"');
  });

  it('states the four eyes rule rather than hiding the button behind it', () => {
    const html = render({
      item: caseView({
        status: 'DECIDED',
        outcome: 'PASS',
        decidedBy: VIEWER,
        decisionNote: 'السجل نشط',
      }),
    });
    // The rule is refused in the domain and in a trigger under it. What a screen owes the
    // reader is the reason, because a missing button teaches nobody anything.
    expect(html).toContain('data-role="own-decision"');
    expect(html).toContain('لا يعتمد القرارَ من اتخذه');
    expect(html).not.toContain('data-role="approve-case"');
  });

  it('shows the note with the decision, since that is what is read a year later', () => {
    const html = render({
      item: caseView({
        status: 'DECIDED',
        outcome: 'FAIL',
        decidedBy: COLLEAGUE,
        decisionNote: 'السجل موقوف',
      }),
    });
    expect(html).toContain('السجل موقوف');
    expect(html).toContain('مرفوضة');
  });

  it('offers nothing at all on a closed case', () => {
    const html = render({ item: caseView({ status: 'CLOSED', decidedBy: COLLEAGUE }) });
    expect(html).not.toContain('data-role="case-decide"');
    expect(html).not.toContain('data-role="approve-case"');
    expect(html).not.toContain('data-role="case-assign"');
  });

  it('says what the last action did', () => {
    expect(render({ outcome: 'four-eyes' })).toContain('data-tone="refused"');
    expect(render({ outcome: 'approved' })).toContain('data-tone="done"');
  });
});

describe('closing a detected change', () => {
  const change = {
    changeEventId: 'ch1',
    entityId: 'e1',
    entityName: 'مؤسسة نماء',
    fieldPath: 'cr.status',
    severity: 'WARNING' as const,
    reasonAr: 'تغيّرت حالة السجل',
    detectedAt: new Date('2026-09-15T09:00:00Z'),
  };
  const page = { rows: [change], total: 1, page: 1, size: 25 as const, pages: 1 };
  const empty = { rows: [], total: 0, page: 1, size: 25 as const, pages: 0 };

  const monitoring = (acknowledgeAction?: (formData: FormData) => Promise<void>): string =>
    renderToStaticMarkup(
      <Monitoring
        changes={page}
        stale={empty}
        params={{}}
        path="/customers/alerts"
        {...(acknowledgeAction === undefined ? {} : { acknowledgeAction })}
      />,
    );

  it('offers a way to close it, so the count can go down as well as up', () => {
    expect(monitoring(noop)).toContain('data-role="acknowledge-change"');
  });

  it('offers nothing where the screen only reports', () => {
    expect(monitoring()).not.toContain('data-role="acknowledge-change"');
  });
});

describe('the freshness screen, which could preview and not apply', () => {
  const rows = [
    { fieldPath: 'cr', ttlDays: 30, weight: 10, source: 'system' as const },
    { fieldPath: 'manager', ttlDays: 60, weight: 8, source: 'tenant' as const },
  ];

  const render = (editable: boolean): string =>
    renderToStaticMarkup(
      <FreshnessSettings
        rows={rows}
        {...(editable ? { saveAction: noop, clearAction: noop } : {})}
      />,
    );

  it('makes every row editable and offers both asking and doing', () => {
    const html = render(true);
    expect(html).toContain('name="ttl_days"');
    expect(html).toContain('name="weight"');
    expect(html).toContain('data-role="preview-ttl"');
    expect(html).toContain('data-role="save-ttl"');
  });

  it('offers a way back to the default only where the subscriber changed it', () => {
    // One of the two rows is the platform's own value, and there is nothing to undo on it.
    expect(render(true).match(/data-role="clear-ttl"/g) ?? []).toHaveLength(1);
  });

  it('keeps saying that a duration rewrites nothing', () => {
    // People assume an edit like this is destructive, and guard 07 proves it is not.
    expect(render(true)).toContain('data-role="inert-notice"');
    expect(render(true)).toContain('لا يغيّر أي إفادة سابقة');
  });

  it('reads as a table with no controls where nothing may be changed', () => {
    const html = render(false);
    expect(html).not.toContain('name="ttl_days"');
    expect(html).not.toContain('data-role="save-ttl"');
  });

  it('names a family of fields in Arabic rather than showing its path', () => {
    // A policy is written on a prefix, not a leaf, and a prefix is not in the catalogue.
    // Fourteen of these rows used to read «governance» and «liquidator» on an Arabic screen.
    expect(fieldLabel('manager')).toBe('المدراء المفوضون');
    expect(fieldLabel('liquidator')).toBe('المصفّي');
    expect(fieldLabel('cr.status')).toBe('حالة السجل التجاري');
    // And a path nobody named still shows itself rather than disappearing.
    expect(fieldLabel('nothing.known')).toBe('nothing.known');
  });
});
