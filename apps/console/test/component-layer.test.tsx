import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { slicePage } from '@nx-verify/core';
import { describe, expect, it } from 'vitest';
import { OperatorHealth, type HealthRowView } from '../src/components/operator-health';
import { OperatorMargin } from '../src/components/operator-margin';
import { OperatorPackages, type PackageView } from '../src/components/operator-packages';
import { PendingTopUps, TopUpPanel, type TopUpRowView } from '../src/components/topup';

/**
 * «لا أزرار أو وسوم مخصّصة داخل الشاشات» (CLAUDE.md, design rules), asserted on the four
 * screens that were still drawing their own.
 *
 * Two halves, because either alone passes while the rule is broken. The first reads the
 * source and refuses the class names a screen has no business writing. The second renders
 * the screens and insists the sheet's own classes are still in the markup, so a conversion
 * that quietly dropped `.stat` or `.revoke` and changed how the screen looks fails here
 * rather than in somebody's browser.
 */

const SCREENS = ['operator-packages', 'operator-margin', 'topup', 'operator-health'] as const;

const sourceOf = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/components/${name}.tsx`, import.meta.url)), 'utf8');

/** A class name a screen may not write, and the component that owns it instead. */
const OWNED: readonly [RegExp, string][] = [
  [/className="btn/, 'Button, ButtonLink, SubmitButton'],
  [/className="tag/, 'Tag, StateTag, TagLink, TagToggle'],
  [/className="input/, 'Input'],
  [/<button\b/, 'Button'],
  [/className="stat[ "]/, 'Stat'],
  [/className="stat-(label|value|hint)"/, 'StatLabel, StatValue, StatHint'],
  [/card-title admin-card-title/, 'CardTitle size="section"'],
  [/className="admin-card-head"/, 'CardHead'],
  [/className="admin-card-note"/, 'CardNote'],
  [/className="admin-empty"/, 'CardEmpty'],
  [/className="muted"/, 'NoValue'],
  [/<details\b/, 'Disclosure'],
  [/<summary\b/, 'Disclosure'],
];

describe('the four screens draw nothing of their own', () => {
  for (const screen of SCREENS) {
    it(`${screen} reaches every control through the component layer`, () => {
      const source = sourceOf(screen);
      for (const [pattern, owner] of OWNED) {
        expect(pattern.test(source), `${screen} writes ${pattern.source}; ${owner} owns it`).toBe(
          false,
        );
      }
    });

    it(`${screen} decides no spacing, colour or radius of its own`, () => {
      // Not even through a token: a screen that sets a gap inline is a screen holding a
      // layout decision that belongs to the sheet, where the next screen can find it.
      expect(sourceOf(screen)).not.toContain('style={{');
    });
  }
});

const healthRow: HealthRowView = {
  tenantId: 't1',
  legalName: 'شركة متعثرة',
  slug: 'struggling',
  isSandbox: false,
  calls: 40,
  failures: 12,
  slowestMs: 900,
  balanceHalalas: 50_000,
  heldHalalas: 0,
  balanceLow: true,
  unhealthyProviders: ['wathq-example-connector'],
};

const quietRow: HealthRowView = {
  ...healthRow,
  tenantId: 't2',
  legalName: 'شركة هادئة',
  slug: 'quiet',
  calls: 0,
  failures: 0,
  slowestMs: 0,
  balanceHalalas: 900_000,
  balanceLow: false,
  unhealthyProviders: [],
};

const health = (rows: HealthRowView[]): string =>
  renderToStaticMarkup(<OperatorHealth rows={rows} windowHours={24} />);

describe('the components put back exactly what the screens used to draw', () => {
  it('keeps the figures along the top as tiles the sheet knows', () => {
    const html = health([healthRow, quietRow]);
    expect(html).toContain('<section class="grid" data-role="health-tiles">');
    expect(html).toContain('<article class="stat"');
    expect(html).toContain('<span class="stat-label">');
    expect(html).toContain('<strong class="stat-value">');
    expect(html).toContain('<span class="stat-hint">');
  });

  it('tints a tile only when there is something to look at', () => {
    // One row is failing here, so the failures tile is critical and the two amber ones are
    // tinted too. A tile that is always tinted is a tile nobody reads.
    expect(health([healthRow])).toContain('data-tone="critical"');
    const calm = health([quietRow]);
    expect(calm).not.toContain('data-tone="critical"');
    expect(calm).not.toContain('data-tone="changed"');
  });

  it('keeps the head and the empty line of a card', () => {
    const html = health([]);
    expect(html).toContain('<div class="admin-card-head">');
    expect(html).toContain(
      '<h2 class="card-title admin-card-title" id="health-subscribers-title">',
    );
    expect(html).toContain('<p class="admin-card-note">');
    expect(html).toContain('<p class="admin-empty" data-role="empty-state">');
    expect(html).toContain('لا مشترك مفعّل بعد، فلا صحة خدمة تُقاس.');
  });

  it('says in words what a cell has nothing in', () => {
    const html = health([quietRow]);
    // Not «0 مللي ثانية», which reads as an instant answer.
    expect(html).toContain('<span class="muted">لا نداءات</span>');
    expect(html).toContain('<span class="muted">أصحّاء</span>');
  });
});

describe('an act with nothing to undo it', () => {
  const pending = renderToStaticMarkup(
    <PendingTopUps
      pending={[
        {
          id: 't1',
          tenantId: 'w1',
          tenantName: 'شركة العميل',
          reference: 'TOP-2026-000004',
          amountHalalas: 100_000,
          totalWithVatHalalas: 115_000,
          status: 'REQUESTED',
          requestedAt: new Date('2026-09-12T00:00:00Z'),
          vatInvoiceId: null,
          note: null,
        },
      ]}
      confirmAction="/c"
      rejectAction="/r"
    />,
  );

  it('is still the two step disclosure the sheet draws', () => {
    expect(pending).toContain('<details class="revoke" data-role="reject-topup">');
    expect(pending).toContain('<summary>لم تصل الحوالة</summary>');
  });

  it('puts the consequence before the control, which is the whole pattern (ADR-167)', () => {
    const body = pending.slice(pending.indexOf('data-role="reject-topup"'));
    expect(body.indexOf('لا يعود إلى هذه القائمة')).toBeLessThan(
      body.indexOf('data-role="reject-confirm"'),
    );
    // And the component owns the gap, so no screen can open straight onto the button.
    expect(pending).toContain('<div class="revoke-body">');
  });
});

/**
 * Three things these screens were told and did not say. Each was read from the database,
 * carried into the screen as a prop, and then rendered nowhere.
 */
describe('what the screens knew and were not saying', () => {
  it('shows the balance the subscriber can actually spend, and what is held back', () => {
    const held = health([{ ...healthRow, balanceHalalas: 50_000, heldHalalas: 20_000 }]);
    // 500.00 was the figure before, while the subscriber's own screen showed 300.00: support
    // and the customer read two different balances off two screens.
    expect(held).toContain('300.00');
    expect(held).not.toContain('500.00');
    expect(held).toContain('data-role="held"');
    expect(held).toContain('محجوز لعمليات جارية');

    // Nothing held, nothing said: a line reading «محجوز: 0.00» is noise on every other row.
    expect(health([healthRow])).not.toContain('data-role="held"');
  });

  it('tells a subscriber why a transfer was not accepted', () => {
    const row: TopUpRowView = {
      id: 't1',
      reference: 'TOP-2026-000004',
      amountHalalas: 100_000,
      totalWithVatHalalas: 115_000,
      status: 'REJECTED',
      requestedAt: new Date('2026-09-12T00:00:00Z'),
      vatInvoiceId: null,
      note: 'لم تصل الحوالة',
    };
    const bank = { accountName: null, bankName: null, iban: null };

    const rejected = renderToStaticMarkup(<TopUpPanel requests={[row]} bank={bank} />);
    expect(rejected).toContain('data-role="topup-reason"');
    // «لم يُقبل» alone leaves nothing to act on: it could mean the transfer never arrived or
    // that we refused it, and only one of those is the subscriber's to fix.
    expect(rejected).toContain('لم تصل الحوالة');

    // A request still waiting has no reason to give, and carries none.
    const waiting = renderToStaticMarkup(
      <TopUpPanel requests={[{ ...row, status: 'REQUESTED', note: null }]} bank={bank} />,
    );
    expect(waiting).not.toContain('data-role="topup-reason"');
  });

  it('marks a plan we no longer sell, on its card and in the move list', () => {
    const plan: PackageView = {
      code: 'LEGACY',
      nameAr: 'الباقة القديمة',
      billingModel: 'ANNUAL',
      termMonths: 12,
      includedTransactions: 100,
      platformFeeHalalas: 0,
      status: 'retired',
      products: [],
    };
    const render = (packages: PackageView[]): string =>
      renderToStaticMarkup(
        <OperatorPackages
          notice={null}
          packages={packages}
          subscribers={[
            {
              tenantId: 't1',
              legalName: 'شركة العميل',
              slug: 'acme',
              isSandbox: false,
              packageCode: 'LEGACY',
              includedTransactions: 100,
              transactionsUsed: 4,
              overrides: [],
            },
          ]}
          allProducts={[{ code: 'KYB_COMPLETE', nameAr: 'التحقق الشامل' }]}
          setProductAction="/p"
          setOverrideAction="/o"
          assignAction="/a"
        />,
      );

    const onSale: PackageView = { ...plan, code: 'GROWTH', nameAr: 'باقة النمو', status: 'active' };

    const retired = render([plan, onSale]);
    expect(retired).toContain('data-role="retired-plan"');
    // And the option that would move a subscriber onto it says so in the same words, rather
    // than reading exactly like a plan we still sell.
    expect(retired).toContain('الباقة القديمة · متقاعدة');

    const active = render([onSale]);
    expect(active).not.toContain('data-role="retired-plan"');
    expect(active).not.toContain('متقاعدة');
  });

  /*
   * The move refuses anything but an active plan (`setTenantPackage`, NX-4041) and the action
   * behind this form catches nothing, so an offered retired plan was a press that replaced the
   * panel with the error screen.
   */
  it('names a retired plan in the move list without letting anybody pick it', () => {
    const plan: PackageView = {
      code: 'LEGACY',
      nameAr: 'الباقة القديمة',
      billingModel: 'ANNUAL',
      termMonths: 12,
      includedTransactions: 100,
      platformFeeHalalas: 0,
      status: 'retired',
      products: [],
    };
    const render = (packages: PackageView[]): string =>
      renderToStaticMarkup(
        <OperatorPackages
          notice={null}
          packages={packages}
          subscribers={[
            {
              tenantId: 't1',
              legalName: 'شركة العميل',
              slug: 'acme',
              isSandbox: false,
              packageCode: 'LEGACY',
              includedTransactions: 100,
              transactionsUsed: 4,
              overrides: [],
            },
          ]}
          allProducts={[{ code: 'KYB_COMPLETE', nameAr: 'التحقق الشامل' }]}
          setProductAction="/p"
          setOverrideAction="/o"
          assignAction="/a"
        />,
      );

    const mixed = render([
      plan,
      { ...plan, code: 'GROWTH', nameAr: 'باقة النمو', status: 'active' },
    ]);
    expect(mixed).toContain('<option value="LEGACY" disabled="">');
    expect(mixed).toContain('<option value="GROWTH">');
    expect(mixed).toContain('data-role="assign-confirm"');

    // And with nothing on sale there is no destination at all, so the form is a sentence
    // rather than a button whose only outcome is the error screen.
    const none = render([plan]);
    expect(none).toContain('data-role="no-destination"');
    expect(none).not.toContain('data-role="assign-confirm"');
  });
});

describe('the report that crosses subscribers keeps its own rules', () => {
  const html = renderToStaticMarkup(
    <OperatorMargin
      page={slicePage(
        [
          {
            tenantName: 'Customer Two',
            productNameAr: 'التحقق الشامل من المنشأة',
            periodStart: new Date('2026-09-01T00:00:00Z'),
            runs: 4,
            packageRuns: 4,
            billedHalalas: 0,
            providerCostHalalas: 2400,
            grossHalalas: -2400,
            marginPct: null,
          },
        ],
        { page: 1, size: 25 },
      )}
      totals={{ runs: 4, billedHalalas: 0, providerCostHalalas: 2400, packageRuns: 4 }}
      params={{}}
    />,
  );

  it('still says a margin on no revenue is undefined rather than zero', () => {
    expect(html).toContain('<span class="muted">لا إيراد</span>');
    expect(html).toContain('data-role="margin-cell"');
  });

  it('carries the unit on every tile, because three of the four are money', () => {
    expect(html).toContain('data-role="margin-tiles"');
    expect(html).toContain('عملية');
    expect(html).toContain('ر.س');
  });
});
