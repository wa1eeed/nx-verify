import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { FieldCard, formatValue, daysUntil } from '../components/field-card';
import { ChangeBadge, FreshnessBadge } from '../components/freshness';
import { Identifier, Money } from '../components/identifier';
import { Entity360 } from '../components/entity-360';
import { FreshnessSettings } from '../components/freshness-settings';
import { Timeline } from '../components/timeline';
import RootLayout from '../app/layout';
import AuthLayout from '../app/(auth)/layout';
import { ReviewQueue, reasonLabel } from '../components/review-queue';
import { Dashboard } from '../components/dashboard';
import { Portfolios } from '../components/portfolios';
import { RulesStudio, describeCondition } from '../components/rules-studio';
import { NotificationSettings, eventLabel } from '../components/notification-settings';
import { ChangePassword } from '../components/change-password';
import { ApiKeys } from '../components/api-keys';
import { Shell } from '../components/shell';
import { OnboardingList } from '../components/onboarding';
import { OperatorMargin } from '../components/operator-margin';
import { Developer } from '../components/developer';
import { OnboardingCaseView, stepStatusLabel, waiveReasonLabel } from '../components/onboarding-case';
import { Usage, refusalLabel } from '../components/usage';
import { Statement } from '../components/statement';
import { NAV } from '../components/nav';
import { EmptyState, PageHeader, Panel } from '../components/page-header';
import type { ProfileFieldView } from '../components/field-card';

/**
 * The interface rules from CLAUDE.md, asserted rather than eyeballed.
 *
 * Every one of these is a rule that is easy to honour on the day it is written and easy
 * to break six months later in a component nobody remembers.
 */

const FIELD: ProfileFieldView = {
  fieldPath: 'cr.status',
  value: 'ACTIVE',
  authority: 'Commercial Registry',
  observedAt: new Date('2026-08-01T10:00:00Z'),
  effectiveUntil: new Date('2026-09-15T10:00:00Z'),
  freshness: 'fresh',
  confidence: 1,
};

describe('every field carries its source and its timestamp', () => {
  it('renders the authority and the observation date on a field card', () => {
    const html = renderToStaticMarkup(<FieldCard field={FIELD} now={new Date('2026-09-08')} />);
    expect(html).toContain('data-role="authority"');
    expect(html).toContain('Commercial Registry');
    expect(html).toContain('data-role="observed-at"');
    expect(html).toContain('2026-08-01');
  });

  it('shows how long the field has left', () => {
    const html = renderToStaticMarkup(<FieldCard field={FIELD} now={new Date('2026-09-08')} />);
    expect(html).toContain('data-role="remaining"');
    expect(html).toContain('7 يوماً');
  });

  it('says plainly when a field has expired rather than counting down past zero', () => {
    const expired = { ...FIELD, freshness: 'expired' as const };
    const html = renderToStaticMarkup(<FieldCard field={expired} now={new Date('2026-10-01')} />);
    expect(html).toContain('انتهت منذ');
  });

  it('surfaces a confidence below one, since a name match is weaker evidence', () => {
    const html = renderToStaticMarkup(
      <FieldCard field={{ ...FIELD, confidence: 0.9 }} now={new Date('2026-09-08')} />,
    );
    expect(html).toContain('data-role="confidence"');
  });
});

describe('expired and changed never look alike', () => {
  it('gives them different colours and different markers', () => {
    const expired = renderToStaticMarkup(<FreshnessBadge state="expired" />);
    const changed = renderToStaticMarkup(<ChangeBadge severity="WARNING" />);

    expect(expired).toContain('data-kind="freshness"');
    expect(changed).toContain('data-kind="change"');

    // Neutral grey for aged knowledge, warning for a detected difference. Painting them
    // alike is what makes people stop reading alerts.
    expect(expired).toContain('--expired-fg');
    expect(changed).toContain('--changed-fg');
    expect(expired).not.toContain('--changed-fg');
    expect(changed).not.toContain('--expired-fg');
  });

  it('keeps a critical change apart from an ordinary one', () => {
    const critical = renderToStaticMarkup(<ChangeBadge severity="CRITICAL" />);
    expect(critical).toContain('--critical-fg');
    expect(critical).toContain('حرج');
  });
});

describe('identifiers read left to right inside a right to left page', () => {
  it('wraps an identifier in an explicit ltr monospace element', () => {
    const html = renderToStaticMarkup(<Identifier value="1010478213" label="CR" />);
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('class="mono"');
  });

  it('does the same for money', () => {
    const html = renderToStaticMarkup(<Money amount={44} />);
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('44.00');
    expect(html).toContain('ريال');
  });

  it('treats a value that is really a number as an identifier', () => {
    expect(formatValue(500000).numeric).toBe(true);
    expect(formatValue('شركة المثال').numeric).toBe(false);
    expect(formatValue(null).text).toBe('غير متوفر');
    expect(formatValue(true).text).toBe('نعم');
  });

  it('counts remaining days from the effective date', () => {
    expect(daysUntil(new Date('2026-09-18'), new Date('2026-09-08'))).toBe(10);
    expect(daysUntil(null)).toBeNull();
  });
});

describe('one primary button per screen', () => {
  const props = {
    header: {
      entityId: 'e1',
      displayName: 'شركة المثال',
      entityType: 'BUSINESS',
      identifiers: [{ idType: 'CR', masked: '••••••8213' }],
      score: 72,
      scoreBreakdown: [
        { fieldPath: 'cr.status', weight: 20, earned: 20, freshness: 'fresh' },
        { fieldPath: 'address.national', weight: 14, earned: 0, freshness: 'expired' },
      ],
      completeness: 50,
    },
    fields: [FIELD],
    changes: [
      { fieldPath: 'cr.status', severity: 'CRITICAL' as const, detectedAt: new Date('2026-09-01') },
    ],
    timeline: [
      {
        attestationId: 'a1',
        fieldPath: 'cr.status',
        value: 'ACTIVE',
        authority: 'Commercial Registry',
        observedAt: new Date('2026-08-01T10:00:00Z'),
        triggeredBy: 'MONITOR' as const,
        changed: true,
      },
    ],
    now: new Date('2026-09-08'),
  };

  it('renders exactly one primary action on entity 360', () => {
    const html = renderToStaticMarkup(<Entity360 {...props} />);
    expect(html.match(/btn-primary/g) ?? []).toHaveLength(1);
    expect(html).toContain('تحديث التحقق');
    // The rest are still reachable, just not competing for attention.
    expect(html.match(/btn-secondary/g)?.length).toBeGreaterThan(0);
  });

  it('shows the change alert and the expiry notice as separate sections', () => {
    const withExpired = {
      ...props,
      fields: [{ ...FIELD, freshness: 'expired' as const }],
    };
    const html = renderToStaticMarkup(<Entity360 {...withExpired} />);
    expect(html).toContain('data-role="alert-changes"');
    expect(html).toContain('data-role="alert-expired"');
  });

  it('shows no alert section when there is nothing to say', () => {
    const quiet = { ...props, changes: [] };
    const html = renderToStaticMarkup(<Entity360 {...quiet} />);
    expect(html).not.toContain('data-role="alert-changes"');
    expect(html).not.toContain('data-role="alert-expired"');
  });

  it('never shows a score without its working', () => {
    const html = renderToStaticMarkup(<Entity360 {...props} />);
    // A number without a breakdown is refused by risk management. Showing one without
    // the other on screen would put the analyst in the same position.
    expect(html).toContain('data-role="score-breakdown"');
    expect(html).toContain('كيف حُسبت الدرجة');
    expect(html).toContain('72');
  });

  it('marks a counterparty linked to several entities as a signal', () => {
    const html = renderToStaticMarkup(
      <Entity360
        {...props}
        relations={[
          {
            relType: 'MANAGES',
            otherEntityId: 'p1',
            otherName: 'محمد عبدالله',
            direction: 'from',
            linkedCount: 7,
          },
          {
            relType: 'OWNS',
            otherEntityId: 'p2',
            otherName: 'شريك',
            direction: 'from',
            linkedCount: 1,
          },
        ]}
      />,
    );

    expect(html).toContain('data-role="relations"');
    expect(html).toContain('data-signal="high"');
    expect(html).toContain('data-signal="normal"');
    expect(html).toContain('إشارة شبكة');
    // The limit is contractual as well as technical, and the screen says so.
    expect(html).toContain('لا تجميع عبر العملاء');
  });

  it('names what triggered each line of the timeline', () => {
    const html = renderToStaticMarkup(<Timeline entries={props.timeline} />);
    // The auditor's question is not "did it change" but "how did you find out".
    expect(html).toContain('من المراقبة');
  });
});

describe('the settings screen states what an edit does before it is made', () => {
  it('says that changing a duration rewrites nothing', () => {
    const html = renderToStaticMarkup(
      <FreshnessSettings
        rows={[{ fieldPath: 'cr.status', ttlDays: 7, weight: 20, source: 'system' }]}
      />,
    );
    expect(html).toContain('data-role="inert-notice"');
    expect(html).toContain('لا يغيّر أي إفادة');
  });

  it('shows where each value came from, so it can be put back', () => {
    const html = renderToStaticMarkup(
      <FreshnessSettings
        rows={[
          { fieldPath: 'cr.status', ttlDays: 7, weight: 20, source: 'system' },
          { fieldPath: 'cr.core', ttlDays: 30, weight: 26, source: 'tenant' },
        ]}
      />,
    );
    expect(html).toContain('data-source="system"');
    expect(html).toContain('data-source="tenant"');
    expect(html).toContain('معدّل من المشترك');
  });

  it('previews the impact before saving', () => {
    const html = renderToStaticMarkup(
      <FreshnessSettings
        rows={[]}
        preview={{ fieldPath: 'address.national.city', proposedTtlDays: 10, newlyExpired: 340 }}
      />,
    );
    expect(html).toContain('data-role="impact-preview"');
    expect(html).toContain('340');
  });

  it('shows the weight next to the duration', () => {
    const html = renderToStaticMarkup(
      <FreshnessSettings
        rows={[{ fieldPath: 'cr.status', ttlDays: 7, weight: 20, source: 'system' }]}
      />,
    );
    // A duration without a weight has no meaning in the confidence score.
    expect(html).toContain('الوزن في الدرجة');
  });
});

describe('the document itself', () => {
  it('is right to left and in Arabic', () => {
    const html = renderToStaticMarkup(<RootLayout>{null}</RootLayout>);
    expect(html).toContain('lang="ar"');
    expect(html).toContain('dir="rtl"');
  });

  it('loads the two named typefaces', () => {
    const html = renderToStaticMarkup(<RootLayout>{null}</RootLayout>);
    expect(html).toContain('IBM+Plex+Sans+Arabic');
    expect(html).toContain('IBM+Plex+Mono');
  });

  it('uses solid borders and no rgba shadows', () => {
    const css = readFileSync(fileURLToPath(new URL('../app/tokens.css', import.meta.url)), 'utf8');
    expect(css).not.toMatch(/rgba\(/);
    expect(css).not.toMatch(/box-shadow/);
    expect(css).toContain('border: 1px solid');
  });

  it('carries the four brand colours', () => {
    const css = readFileSync(fileURLToPath(new URL('../app/tokens.css', import.meta.url)), 'utf8');
    for (const colour of ['#0a1628', '#00d2a8', '#00a886', '#f5b942']) {
      expect(css).toContain(colour);
    }
  });
});

describe('the phase two screens keep the same rules', () => {
  const queueRows = [
    {
      caseId: 'c1',
      entityId: 'e1',
      entityName: 'شركة المثال',
      reasonCodes: ['ADDRESS_UNAVAILABLE'],
      status: 'OPEN' as const,
      assignedTo: null,
      decidedBy: null,
      ageHours: 51.4,
      overdue: true,
    },
    {
      caseId: 'c2',
      entityId: 'e2',
      entityName: 'منشأة ثانية',
      reasonCodes: ['NETWORK_SIGNAL'],
      status: 'DECIDED' as const,
      assignedTo: 'user:analyst-1',
      decidedBy: 'user:analyst-1',
      ageHours: 3,
      overdue: false,
    },
  ];

  it('shows one primary action on the review queue', () => {
    const html = renderToStaticMarkup(<ReviewQueue rows={queueRows} />);
    expect(html.match(/btn-primary/g) ?? []).toHaveLength(1);
  });

  it('marks a late case and names who decided', () => {
    const html = renderToStaticMarkup(<ReviewQueue rows={queueRows} />);
    expect(html).toContain('data-overdue="true"');
    expect(html).toContain('متأخرة');
    // The control is visible, not merely enforced.
    expect(html).toContain('user:analyst-1');
    expect(html).toContain('لا يجوز أن يكون المقرِّر هو المعتمِد');
  });

  it('translates a reason code rather than showing it raw', () => {
    expect(reasonLabel('CR_NOT_ACTIVE')).toBe('السجل التجاري غير نشط');
    // An unknown code shows itself rather than disappearing.
    expect(reasonLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('keeps aged out and changed apart on the dashboard', () => {
    const html = renderToStaticMarkup(
      <Dashboard
        view={{
          entities: 120,
          entitiesWithExpired: 14,
          fieldFreshness: { fresh: 300, expiring: 20, expired: 40, permanent: 5 },
          openChanges: { critical: 2, warning: 6, info: 1 },
          reviewQueue: { open: 9, overdue: 2, awaitingApproval: 1 },
          wallet: { balance: 120_000, isLow: false },
          monitors: { active: 4, budgetExhausted: 1 },
        }}
      />,
    );

    // The two states carry different words as well as different colours, because merging
    // them would be the most misleading number on the page.
    expect(html).toContain('معرفتنا قديمة');
    expect(html).toContain('تحققنا واكتشفنا اختلافاً');
    expect(html).toContain('data-role="freshness"');
    expect(html.match(/btn-primary/g) ?? []).toHaveLength(1);
  });

  it('shows numbers left to right on the dashboard', () => {
    const html = renderToStaticMarkup(
      <Dashboard
        view={{
          entities: 120,
          entitiesWithExpired: 0,
          fieldFreshness: { fresh: 1, expiring: 0, expired: 0, permanent: 0 },
          openChanges: { critical: 0, warning: 0, info: 0 },
          reviewQueue: { open: 0, overdue: 0, awaitingApproval: 0 },
          wallet: { balance: 4_400, isLow: true },
          monitors: { active: 0, budgetExhausted: 0 },
        }}
      />,
    );
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('44.00');
    expect(html).toContain('الرصيد منخفض');
  });

  it('shows what belonging to a portfolio costs and enforces', () => {
    const html = renderToStaticMarkup(
      <Portfolios
        rows={[
          {
            portfolioId: 'p1',
            code: 'MERCHANTS',
            nameAr: 'محفظة التجار',
            entities: 40,
            withExpired: 3,
            openCases: 1,
            monitorByDefault: true,
            monitorBudget: 30_000,
            decisionRuleset: 'r1',
          },
        ]}
      />,
    );

    // A portfolio that does not show its policy is a folder.
    expect(html).toContain('data-role="monitoring"');
    expect(html).toContain('300.00');
    expect(html).toContain('خاصة بالمحفظة');
    expect(html).toContain('تفوز المدة الأقصر');
    expect(html.match(/btn-primary/g) ?? []).toHaveLength(1);
  });
});

describe('the rules studio', () => {
  const rules = [
    {
      seq: 1,
      description: 'cr.status لا يساوي ACTIVE',
      outcome: 'FAIL' as const,
      reasonAr: 'غير نشط',
    },
    { seq: 99, description: 'في كل الحالات الأخرى', outcome: 'PASS' as const, reasonAr: 'مقبول' },
  ];

  it('says that order decides, because it does', () => {
    const html = renderToStaticMarkup(
      <RulesStudio rulesetName="القواعد الافتراضية" isDefault rules={rules} />,
    );
    // A screen that hides evaluation order invites rules that never fire.
    expect(html).toContain('data-role="order-notice"');
    expect(html).toContain('أول قاعدة تنطبق هي التي تحسم');
  });

  it('will not let the system default be edited', () => {
    const html = renderToStaticMarkup(
      <RulesStudio rulesetName="القواعد الافتراضية" isDefault rules={rules} />,
    );
    expect(html).toContain('غير قابل للتعديل');
    expect(html).toContain('disabled');
  });

  it('shows what a change would do before it is saved', () => {
    const html = renderToStaticMarkup(
      <RulesStudio
        rulesetName="قواعد مشددة"
        isDefault={false}
        rules={rules}
        simulation={{
          entitiesEvaluated: 412,
          outcomes: { PASS: 300, FAIL: 12, REVIEW: 100 },
          changed: 87,
        }}
      />,
    );

    expect(html).toContain('data-role="simulation"');
    // The number that stops a Monday morning surprise.
    expect(html).toContain('data-role="changed"');
    expect(html).toContain('87');
  });

  it('describes a condition in words rather than showing json', () => {
    expect(describeCondition({ op: 'always' })).toBe('في كل الحالات الأخرى');
    expect(describeCondition({ op: 'stale', field: 'cr.status' })).toContain('قديم');
    expect(describeCondition({ op: 'linked_gte', relation: 'MANAGES', value: 3 })).toContain('3');
  });
});

/**
 * The notifications screen states what a message carries, because the person choosing
 * recipients is deciding who gets mail from us.
 */
describe('the notifications screen', () => {
  const html = renderToStaticMarkup(
    <NotificationSettings
      channels={[
        {
          id: 'c1',
          address: 'compliance@client.example.sa',
          displayName: 'الامتثال',
          verified: true,
          status: 'active',
          events: [
            { ruleId: 'r1', eventType: 'entity.changed', minSeverity: 'WARNING' },
          ],
        },
        {
          id: 'c2',
          address: 'stranger@example.com',
          displayName: null,
          verified: false,
          status: 'active',
          events: [],
        },
      ]}
    />,
  );

  it('says plainly that a message carries nothing about the subject', () => {
    expect(html).toContain('data-role="content-notice"');
    expect(html).toContain('لا تحمل أي معرّف');
  });

  it('marks an address nobody proved, and says nothing is sent to it', () => {
    expect(html).toContain('data-role="unverified"');
    expect(html).toContain('ولا يُرسَل إليه');
    expect(html).toContain('data-role="verified"');
  });

  it('keeps the address in a left to right run inside the right to left page', () => {
    expect(html).toContain('<bdi dir="ltr" class="mono">compliance@client.example.sa</bdi>');
  });

  it('names the events in Arabic rather than showing the event key', () => {
    expect(eventLabel('entity.changed')).toBe('تغيّر مرصود');
    expect(html).toContain('تغيّر مرصود');
    expect(html).not.toContain('entity.changed');
  });
});

/**
 * A temporary password that is never actually changed is a permanent password that
 * somebody once wrote down.
 */
describe('the change password screen', () => {
  it('says why the person is looking at it after a temporary password', () => {
    const html = renderToStaticMarkup(<ChangePassword forced action="/password" />);
    expect(html).toContain('data-role="forced-notice"');
    expect(html).toContain('مؤقتة');
    // One primary button, and the current password required even though they are in.
    expect(html.match(/btn-primary/g)?.length).toBe(1);
    expect(html.toLowerCase()).toContain('autocomplete="current-password"');
    expect(html.toLowerCase()).toContain('autocomplete="new-password"');
  });

  it('prints the rule rather than hiding it behind a rejection', () => {
    const html = renderToStaticMarkup(<ChangePassword action="/password" />);
    expect(html).toContain('اثنتا عشرة خانة');
    expect(html).not.toContain('data-role="forced-notice"');
  });
});

/**
 * The shell and the furniture.
 *
 * A console that people work in all day is judged on the parts that repeat: where the
 * navigation is, whether the current screen is named, whether a keyboard can get past the
 * navigation, and whether an empty table says something useful.
 */
describe('the console shell', () => {
  const html = renderToStaticMarkup(<Shell isSandbox={false}>{null}</Shell>);

  it('groups the navigation by what a person came to do', () => {
    expect(NAV.map((group) => group.label)).toEqual([
      'المتابعة',
      'العمل',
      'الاشتراك',
      'الإعدادات',
    ]);
    const hrefs = NAV.flatMap((group) => group.items.map((item) => item.href));
    // No link appears twice, and every screen in the app is reachable from the shell.
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toContain('/dashboard');
    expect(hrefs).toContain('/settings/notifications');
    expect(hrefs).toContain('/usage');
    expect(hrefs).toContain('/settings/api-keys');
  });

  it('lets a keyboard skip the navigation, and offers the way out', () => {
    expect(html).toContain('class="skip-link"');
    expect(html).toContain('href="#main"');
    expect(html).toContain('id="main"');
    expect(html).toContain('data-role="sign-out"');
  });

  it('is right to left at the document root, not patched per screen', () => {
    expect(renderToStaticMarkup(<RootLayout>{null}</RootLayout>)).toContain(
      '<html lang="ar" dir="rtl">',
    );
  });

  it('says which world it is in, and shouts when it is the sandbox', () => {
    expect(html).toContain('data-role="environment-name"');
    expect(html).toContain('بيئة الإنتاج');
    expect(html).not.toContain('data-role="sandbox-banner"');

    const sandbox = renderToStaticMarkup(<Shell isSandbox>{null}</Shell>);
    expect(sandbox).toContain('data-role="sandbox-banner"');
    expect(sandbox).toContain('بيئة الاختبار');
  });

  it('offers a visitor with no session neither navigation nor a way out', () => {
    // Both would state something untrue about what they can do.
    const signedOut = renderToStaticMarkup(<AuthLayout>{null}</AuthLayout>);
    expect(signedOut).not.toContain('data-role="sign-out"');
    expect(signedOut).not.toContain('href="/dashboard"');
    expect(signedOut).toContain('NX Verify');
  });
});

describe('the page furniture', () => {
  it('gives a screen a title, a sentence and at most one action', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="لوحة المخاطر"
        subtitle="ما يحتاج قراراً اليوم"
        action={
          <button type="button" className="btn-primary">
            افتح
          </button>
        }
      />,
    );
    expect(html).toContain('data-role="page-header"');
    expect(html).toContain('<h1>لوحة المخاطر</h1>');
    expect(html.match(/btn-primary/g)?.length).toBe(1);
  });

  it('names a panel and says what is in it', () => {
    const html = renderToStaticMarkup(
      <Panel title="الكيانات" aside="4 كياناً" role="entities">
        <p>محتوى</p>
      </Panel>,
    );
    expect(html).toContain('data-role="entities"');
    expect(html).toContain('<h2>الكيانات</h2>');
    expect(html).toContain('4 كياناً');
  });

  it('says what an empty screen means rather than showing a blank box', () => {
    const html = renderToStaticMarkup(<EmptyState>لا حالات مفتوحة.</EmptyState>);
    expect(html).toContain('data-role="empty-state"');
    expect(html).toContain('لا حالات مفتوحة.');
  });
});

describe('the stylesheet holds the layout rules that are easy to break', () => {
  const css = readFileSync(fileURLToPath(new URL('../app/tokens.css', import.meta.url)), 'utf8');

  it('keeps one long table from pushing every screen sideways', () => {
    // A grid item is as wide as its widest child unless it is told otherwise.
    expect(css).toContain('.shell > * {\n  min-width: 0;\n}');
  });

  it('makes focus visible, because this screen is worked by keyboard under audit', () => {
    expect(css).toContain(':focus-visible');
    expect(css).toContain('outline: 2px solid var(--teal-d)');
  });

  it('prints the evidence and not the furniture', () => {
    expect(css).toContain('@media print');
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toContain('.sidebar');
    expect(print).toContain('display: none');
  });
});

/**
 * The portal a subscriber lives in between verifications: what they hold, what they have
 * left, and what it cost.
 */
/**
 * The entity file: what a compliance officer reads before deciding.
 */
describe('the entity file groups what it knows', () => {
  const field = (fieldPath: string, freshness: 'fresh' | 'expired' = 'fresh'): ProfileFieldView => ({
    fieldPath,
    value: 'قيمة',
    authority: 'وزارة التجارة',
    observedAt: new Date('2026-08-01T10:00:00Z'),
    effectiveUntil: new Date('2026-12-01T10:00:00Z'),
    freshness,
    confidence: 1,
  });

  const render = (tab?: string) =>
    renderToStaticMarkup(
      <Entity360
        header={{
          entityId: 'e1',
          displayName: 'مؤسسة نماء',
          entityType: 'BUSINESS',
          identifiers: [{ idType: 'UNN', masked: '7001•••184' }],
          score: 72,
          scoreBreakdown: [],
          completeness: 80,
        }}
        fields={[
          field('cr.status'),
          field('cr.core.name'),
          field('account.ownership'),
          field('property.deed', 'expired'),
        ]}
        changes={[
          { fieldPath: 'account.ownership', severity: 'WARNING', detectedAt: new Date('2026-09-01') },
        ]}
        timeline={[]}
        {...(tab ? { tab } : {})}
        now={new Date('2026-09-08')}
      />,
    );

  it('makes a tab per group of facts, and none for a group with nothing in it', () => {
    const html = render();
    expect(html).toContain('data-role="profile-tabs"');
    expect(html).toContain('data-group="REGISTRY"');
    expect(html).toContain('data-group="BANKING"');
    expect(html).toContain('data-group="PROPERTY"');
    // Nothing was verified about the address, so there is no address tab to disappoint
    // anybody who opens it.
    expect(html).not.toContain('data-group="ADDRESS"');
  });

  it('marks the tabs a reader must not skip, and keeps the two states apart', () => {
    const html = render();
    // A detected change is a warning; an expired field is not. Same rule as everywhere.
    expect(html).toContain('data-role="tab-changed"');
    expect(html).toContain('data-role="tab-expired"');
    expect(html).toContain("data-kind='changed'".replace(/'/g, '"'));
    expect(html).toContain("data-kind='expired'".replace(/'/g, '"'));
  });

  it('opens the first group by default and the asked for one when named', () => {
    const first = render();
    // Registry comes first in the order, so its fields are the ones on screen.
    expect(first).toContain('حالة السجل التجاري');
    expect(first).not.toContain('الصك العقاري');

    const property = render('PROPERTY');
    expect(property).toContain('الصك العقاري');
    expect(property).not.toContain('حالة السجل التجاري');
  });

  it('leads with the figures a reader checks before reading anything', () => {
    const html = render();
    expect(html).toContain('data-role="indicators"');
    expect(html).toContain('درجة الثقة');
    expect(html).toContain('حقائق موثقة');
    expect(html).toContain('آخر تحقق');
    // The tab links carry no script: they work behind a locked down browser and survive
    // a refresh.
    expect(html).toContain('href="/entities/e1?tab=BANKING"');
  });
});

describe('the subscriber portal', () => {
  const keys = [
    {
      id: 'k1',
      name: 'نظام الفوترة',
      keyPrefix: 'nx_live_ab12',
      scopes: ['verifications:write'],
      environment: 'live',
      createdAt: new Date('2026-08-01T00:00:00Z'),
      lastUsedAt: new Date('2026-09-10T00:00:00Z'),
      revokedAt: null,
    },
    {
      id: 'k2',
      name: 'تجربة',
      keyPrefix: 'nx_test_cd34',
      scopes: ['verifications:read'],
      environment: 'sandbox',
      createdAt: new Date('2026-07-01T00:00:00Z'),
      lastUsedAt: null,
      revokedAt: new Date('2026-08-01T00:00:00Z'),
    },
  ];

  it('shows the prefix and never a secret, and says which environment each key is for', () => {
    const html = renderToStaticMarkup(
      <ApiKeys keys={keys} issueAction="/issue" revokeAction="/revoke" />,
    );
    expect(html).toContain('nx_live_ab12');
    expect(html).toContain('data-role="environment"');
    expect(html).toContain('الإنتاج');
    expect(html).toContain('الاختبار');
    // One primary action on the screen: issuing.
    expect(html.match(/btn-primary/g)?.length).toBe(1);
    // A revoked key stays visible, marked, and cannot be revoked twice.
    expect(html).toContain('data-revoked="true"');
    expect(html.match(/data-role="revoke"/g)?.length).toBe(1);
  });

  it('shows a freshly issued secret once, and says it cannot be recovered', () => {
    const html = renderToStaticMarkup(
      <ApiKeys keys={keys} issuedSecret="nx_live_secret" issueAction="/i" revokeAction="/r" />,
    );
    expect(html).toContain('data-role="secret-value"');
    expect(html).toContain('nx_live_secret');
    expect(html).toContain('لا يمكن عرضه مرة أخرى');
  });

  it('says why a module is off rather than greying it out', () => {
    const html = renderToStaticMarkup(
      <Usage
        view={{
          packageNameAr: 'النمو',
          packageCode: 'GROWTH',
          status: 'active',
          termStart: new Date('2026-01-01T00:00:00Z'),
          termEnd: new Date('2027-01-01T00:00:00Z'),
          includedTransactions: 12000,
          transactionsUsed: 400,
          balanceHalalas: 500000,
          heldHalalas: 4400,
          availableHalalas: 495600,
          isLow: false,
          entitlements: [
            {
              productCode: 'KYB_COMPLETE',
              nameAr: 'التحقق الشامل',
              allowed: true,
              refusal: null,
              quota: null,
              used: 12,
              remaining: null,
              negotiated: false,
            },
            {
              productCode: 'INCOME_VERIFICATION',
              nameAr: 'إثبات الدخل',
              allowed: false,
              refusal: 'PRODUCT_NOT_IN_PACKAGE',
              quota: null,
              used: 0,
              remaining: null,
              negotiated: false,
            },
          ],
        }}
      />,
    );

    expect(html).toContain('data-role="disabled"');
    expect(html).toContain('غير مشمولة في باقتك');
    expect(refusalLabel('QUOTA_EXHAUSTED')).toContain('الحصة');
    // The capacity left is the number a subscriber came for, so it is a figure not a row.
    expect(html).toContain('data-role="usage-tiles"');
    expect(html).toContain('11600');
  });

  it('calls consumption a statement and keeps the tax invoice with the top up', () => {
    const html = renderToStaticMarkup(
      <Statement
        view={{
          lines: [{ month: '2026-09', productNameAr: 'التحقق الشامل', runs: 12, amountHalalas: 52800 }],
          topUps: [
            { at: new Date('2026-09-01T00:00:00Z'), amountHalalas: 1000000, vatInvoiceId: 'INV-77' },
          ],
          spentThisTermHalalas: 52800,
          extras: null,
        }}
      />,
    );

    expect(html).toContain('كشف الاستهلاك');
    // VAT falls due when credit is bought, not when it is spent. Calling this an invoice
    // would not be a wording problem.
    expect(html).toContain('الفاتورة الضريبية تصدر عند شحن الرصيد');
    expect(html).toContain('INV-77');
    expect(html).toContain('data-role="statement-line"');
  });
});

/**
 * The onboarding screens: what is waiting on us, and what was done to one file.
 */
describe('the onboarding screens', () => {
  const list = renderToStaticMarkup(
    <OnboardingList
      cases={[
        {
          caseId: 'c1',
          reference: 'ONB-2026-000001',
          journeyNameAr: 'تأهيل تاجر',
          entityName: 'مؤسسة نماء',
          status: 'IN_REVIEW',
          outcome: 'REVIEW',
          done: 2,
          total: 3,
          dueAt: new Date('2026-09-01T00:00:00Z'),
          overdue: true,
        },
        {
          caseId: 'c2',
          reference: 'ONB-2026-000002',
          journeyNameAr: 'تأهيل تاجر',
          entityName: null,
          status: 'APPROVED',
          outcome: 'PASS',
          done: 3,
          total: 3,
          dueAt: new Date('2026-10-01T00:00:00Z'),
          overdue: false,
        },
      ]}
    />,
  );

  it('leads with what is waiting, and marks a file that ran out of time', () => {
    expect(list).toContain('data-role="onboarding-tiles"');
    expect(list).toContain('data-role="overdue"');
    expect(list).toContain('data-overdue="true"');
    // One primary action: opening a file.
    expect(list.match(/btn-primary/g)?.length).toBe(1);
  });

  it('spends colour on outcomes and not on waiting', () => {
    // Approved and rejected are outcomes. A file waiting for a person carries neither
    // palette, because the warning colour belongs to a detected change and nothing else.
    expect(list).toContain('data-status="APPROVED"');
    expect(list).toContain('data-status="IN_REVIEW"');
    expect(list).not.toContain('--changed-line');
  });

  it('answers what was checked, what was waived and why, and what it set off', () => {
    const detail = renderToStaticMarkup(
      <OnboardingCaseView
        view={{
          caseId: 'c1',
          reference: 'ONB-2026-000001',
          journeyNameAr: 'تأهيل تاجر',
          entityId: 'e1',
          entityName: 'مؤسسة نماء',
          status: 'APPROVED',
          outcome: 'PASS',
          clientRef: 'MER-88',
          openedAt: new Date('2026-08-01T00:00:00Z'),
          dueAt: new Date('2026-08-03T00:00:00Z'),
          closedAt: new Date('2026-08-02T00:00:00Z'),
          overdue: false,
          steps: [
            {
              stepKey: 'company',
              productNameAr: 'التحقق الشامل',
              required: true,
              status: 'DONE',
              runId: 'r1',
              runReference: 'VRF-2026-000019',
              waiveReason: null,
              decidedAt: new Date('2026-08-01T01:00:00Z'),
            },
            {
              stepKey: 'address',
              productNameAr: 'العنوان الوطني',
              required: true,
              status: 'WAIVED',
              runId: null,
              runReference: null,
              waiveReason: 'DOCUMENT_ON_FILE',
              decidedAt: new Date('2026-08-01T02:00:00Z'),
            },
          ],
          actions: [
            {
              actionKey: 'activate',
              actionType: 'WEBHOOK',
              outcome: 'APPROVED',
              delivered: true,
              at: new Date('2026-08-02T00:00:00Z'),
            },
          ],
        }}
      />,
    );

    expect(detail).toContain('data-role="case-steps"');
    expect(detail).toContain('VRF-2026-000019');
    // The waiver says why, from the closed set, so the answer reads the same on every
    // screen and in every report.
    expect(detail).toContain('data-role="waive-reason"');
    expect(detail).toContain('مستند محفوظ لدى العميل');
    expect(detail).toContain('data-role="case-actions"');
    expect(stepStatusLabel('NOT_APPLICABLE')).toBe('لا تنطبق');
    expect(waiveReasonLabel('RISK_ACCEPTED')).toBe('مخاطرة مقبولة');
  });

  it('says plainly when a decision set nothing off, and that it is not a fault', () => {
    const quiet = renderToStaticMarkup(
      <OnboardingCaseView
        view={{
          caseId: 'c2',
          reference: 'ONB-2026-000002',
          journeyNameAr: 'رحلة هادئة',
          entityId: null,
          entityName: null,
          status: 'APPROVED',
          outcome: 'PASS',
          clientRef: null,
          openedAt: new Date('2026-08-01T00:00:00Z'),
          dueAt: new Date('2026-08-03T00:00:00Z'),
          closedAt: new Date('2026-08-02T00:00:00Z'),
          overdue: false,
          steps: [],
          actions: [],
        }}
      />,
    );

    expect(quiet).toContain('data-role="no-actions"');
    expect(quiet).toContain('هذا ليس عطلاً');
  });
});

/**
 * The one screen that crosses subscribers, and the two figures it must not round away.
 */
describe('the operator margin screen', () => {
  const html = renderToStaticMarkup(
    <OperatorMargin
      rows={[
        {
          tenantName: 'Customer One',
          productNameAr: 'التحقق من العنوان الوطني',
          periodStart: new Date('2026-09-01T00:00:00Z'),
          runs: 10,
          packageRuns: 0,
          billedHalalas: 8000,
          providerCostHalalas: 3000,
          grossHalalas: 5000,
          marginPct: 63,
        },
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
      ]}
    />,
  );

  it('shows work the package covered rather than folding it into revenue', () => {
    expect(html).toContain('data-role="margin-tiles"');
    expect(html).toContain('غطّتها الباقات');
    expect(html).toContain('data-role="margin-row"');
  });

  it('says a margin on no revenue is undefined rather than printing zero', () => {
    expect(html).toContain('data-role="margin-cell"');
    expect(html).toContain('لا إيراد');
    expect(html).toContain('63%');
  });

  it('names no entity and no decision, because it reads counters and not runs', () => {
    expect(html).not.toContain('entity');
    expect(html).not.toContain('decision');
  });
});

/**
 * The screen an engineer opens with one afternoon to decide whether integrating will hurt.
 */
describe('the developer screen', () => {
  const render = (isSandbox: boolean) =>
    renderToStaticMarkup(
      <Developer
        view={{
          isSandbox,
          apiBaseUrl: 'https://api.nx.sa',
          keyPrefix: 'nx_test_ab12',
          testCases: [
            {
              input: '7000000010',
              productCode: 'KYB_COMPLETE',
              scenario: 'expired_cr',
              titleAr: 'سجل تجاري منتهٍ',
              expectedAr: 'المنشأة موجودة وحالة سجلها EXPIRED.',
            },
          ],
          scenarioNames: ['success', 'expired_cr', 'not_found'],
        }}
      />,
    );

  it('publishes which input returns which answer, rather than describing it', () => {
    const html = render(true);
    expect(html).toContain('data-role="test-cases"');
    expect(html).toContain('7000000010');
    expect(html).toContain('سجل تجاري منتهٍ');
    // A runnable call, in the address bar of the copy button rather than in a paragraph.
    expect(html).toContain('data-role="curl"');
    expect(html).toContain('/v1/verifications');
  });

  it('says how to tell the two worlds apart in a response', () => {
    const html = render(true);
    expect(html).toContain('data-role="environment-note"');
    expect(html).toContain('environment');
  });

  it('offers the forced scenarios and says why a live key ignores them', () => {
    const html = render(true);
    expect(html).toContain('X-NX-Test-Scenario');
    expect(html).toContain('data-role="scenario-name"');
    // The sentence that makes the feature safe rather than clever.
    expect(html).toContain('data-role="live-refusal"');
    expect(html).toContain('لفقدت كل نتيجة من المنصة معناها');
  });

  it('tells a person in production that they are, without hiding the test data', () => {
    const live = render(false);
    expect(live).toContain('أنت في بيئة الإنتاج');
    expect(live).toContain('data-role="test-cases"');
    expect(live.match(/btn-primary/g)?.length).toBe(1);
  });
});
