import { slicePage } from '@nx-verify/core';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { FieldCard, formatValue, daysUntil } from '../src/components/field-card';
import { ChangeBadge, FreshnessBadge } from '../src/components/freshness';
import { Identifier, Money } from '../src/components/identifier';
import { Entity360 } from '../src/components/entity-360';
import { SharedProfile } from '../src/components/shared-profile';
import { UserAdmin } from '../src/components/user-admin';
import { PendingTopUps, TopUpPanel } from '../src/components/topup';
import { OperatorReadiness } from '../src/components/operator-readiness';
import { VerificationHistory } from '../src/components/verification-history';
import { Inbox, InboxBell } from '../src/components/inbox';
import { FreshnessSettings } from '../src/components/freshness-settings';
import { Timeline } from '../src/components/timeline';
import RootLayout from '../src/app/layout';
import AuthLayout from '../src/app/(auth)/layout';
import { ReviewQueue, reasonLabel } from '../src/components/review-queue';
import { Portfolios } from '../src/components/portfolios';
import { RulesStudio, describeCondition } from '../src/components/rules-studio';
import { NotificationSettings, eventLabel } from '../src/components/notification-settings';
import { ChangePassword } from '../src/components/change-password';
import { ApiKeys } from '../src/components/api-keys';
import {
  IssuedKey,
  IssuedPassword,
  type IssuedKeyState,
  type IssuedPasswordState,
} from '../src/components/issued-once';
import { Shell } from '../src/components/shell';
import {
  INTEGRATION_TABS,
  PRICING_TABS,
  OPERATOR_SECTIONS,
  OperatorShell,
  SCREEN_LINKED_PAGES,
  SUBSCRIBER_TABS,
} from '../src/components/operator-shell';
import { OnboardingList } from '../src/components/onboarding';
import { OperatorMargin } from '../src/components/operator-margin';
import { Developer } from '../src/components/developer';
import { OperatorPackages, billingLabel } from '../src/components/operator-packages';
import { ApiLog } from '../src/components/api-log';
import { OperatorHealth } from '../src/components/operator-health';
import { Docs } from '../src/components/docs';
import { OperatorIntegration, type IntegrationView } from '../src/components/operator-integration';
import { Support, supportTierLabel } from '../src/components/support';
import {
  OnboardingCaseView,
  stepStatusLabel,
  waiveReasonLabel,
} from '../src/components/onboarding-case';
import { Usage, refusalLabel } from '../src/components/usage';
import { Statement } from '../src/components/statement';
import {
  BILLING_TABS,
  CUSTOMER_TABS,
  DEVELOPER_TABS,
  SECTIONS,
  SETTINGS_TABS,
  VERIFICATION_TABS,
} from '../src/components/nav';
import { isInSection } from '../src/components/section-nav';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EmptyState, PageHeader, Panel } from '../src/components/page-header';
import type { ProfileFieldView } from '../src/components/field-card';

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

  it('loads the one face the platform uses, and no other (ADR-125)', () => {
    const html = renderToStaticMarkup(<RootLayout>{null}</RootLayout>);
    expect(html).toContain('IBM+Plex+Sans+Arabic');
    for (const banned of ['Baloo', 'IBM+Plex+Mono', 'Inter', 'Roboto']) {
      expect(html).not.toContain(banned);
    }
  });

  it('takes every colour and shadow from the tokens, outside the token sheet', () => {
    for (const sheet of ['legacy.css', 'product.css']) {
      const css = readFileSync(
        fileURLToPath(new URL(`../src/styles/${sheet}`, import.meta.url)),
        'utf8',
      );
      expect(css, sheet).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, sheet).not.toMatch(/\brgba?\(/);
      for (const shadow of css.match(/box-shadow:[^;]+;/g) ?? []) {
        expect(shadow === 'box-shadow: none;' || shadow.includes('var(--shadow-'), shadow).toBe(
          true,
        );
      }
    }
  });

  it('cascades the old classes first, then the system, then what the product adds', () => {
    const layout = readFileSync(
      fileURLToPath(new URL('../src/app/layout.tsx', import.meta.url)),
      'utf8',
    );
    const order = ['legacy.css', 'organic.css', 'product.css'].map((sheet) =>
      layout.indexOf(sheet),
    );
    expect(order.every((position) => position > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
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
    const html = renderToStaticMarkup(
      <ReviewQueue page={slicePage(queueRows, { page: 1, size: 25 })} overdue={1} params={{}} />,
    );
    expect(html.match(/btn-primary/g) ?? []).toHaveLength(1);
  });

  it('marks a late case and names who decided', () => {
    const html = renderToStaticMarkup(
      <ReviewQueue page={slicePage(queueRows, { page: 1, size: 25 })} overdue={1} params={{}} />,
    );
    expect(html).toContain('data-overdue="true"');
    // The count is the whole queue's, and every row opens its customer's file.
    expect(html).toContain('1 متأخرة من 2');
    expect(html).toContain('data-href="/customers/e1"');
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
          events: [{ ruleId: 'r1', eventType: 'entity.changed', minSeverity: 'WARNING' }],
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

  it('lists the home screen and four places, as the handoff draws them (screen 00)', () => {
    expect(SECTIONS.map((section) => section.label)).toEqual([
      'اللوحة الرئيسية',
      'العملاء',
      'التحقق',
      'الاشتراك والرصيد',
      'الإعدادات',
    ]);
    expect(SECTIONS.map((section) => section.icon)).toEqual([
      'layout-dashboard',
      'users',
      'badge-check',
      'wallet',
      'settings',
    ]);
  });

  it('puts every tab inside exactly one place, and repeats no link', () => {
    const tabs = [CUSTOMER_TABS, VERIFICATION_TABS, BILLING_TABS, SETTINGS_TABS].flat();
    const hrefs = tabs.map((tab) => tab.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    // The keys and webhooks tab holds screens of its own, all inside the settings place.
    for (const tab of [...tabs, ...DEVELOPER_TABS]) {
      const owners = SECTIONS.filter((section) => isInSection(tab.href, section));
      expect(
        owners.map((owner) => owner.label),
        tab.href,
      ).toHaveLength(1);
    }
    expect(DEVELOPER_TABS.every((tab) => tab.href.startsWith('/settings/developers'))).toBe(true);
  });

  it('reaches every screen in the console from a place or one of its tabs', () => {
    // Walked from the file system, so a screen added later without a way to reach it
    // fails here rather than being found by a customer who cannot find it.
    const root = join(__dirname, '../src/app/(app)');
    const pages: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (name === 'page.tsx') {
          pages.push(`/${relative(root, dir)}`.replace(/\/$/, ''));
        }
      }
    };
    walk(root);

    const reachable = new Set([
      ...SECTIONS.map((section) => section.href),
      ...[CUSTOMER_TABS, VERIFICATION_TABS, BILLING_TABS, SETTINGS_TABS, DEVELOPER_TABS]
        .flat()
        .map((tab) => tab.href),
    ]);
    // A detail screen is reached from its list.
    const unreachable = pages.filter((page) => !page.includes('[') && !reachable.has(page));
    expect(unreachable).toEqual([]);
  });

  it('keeps what is left to spend at the foot of the sidebar on every screen', () => {
    const withPackage = renderToStaticMarkup(
      <Shell isSandbox={false} balance={{ kind: 'operations', remaining: 1840, included: 3000 }}>
        {null}
      </Shell>,
    );
    expect(withPackage).toContain('data-role="balance-card"');
    expect(withPackage).toContain('1,840');
    expect(withPackage).toContain('عملية تحقق');
    expect(withPackage).toContain('role="progressbar"');
    expect(withPackage).toContain('شراء رصيد');

    const fromWallet = renderToStaticMarkup(
      <Shell isSandbox={false} balance={{ kind: 'wallet', availableHalalas: 566800 }}>
        {null}
      </Shell>,
    );
    expect(fromWallet).toContain('5,668.00');
    expect(fromWallet).toContain('ريال قبل الضريبة');
    expect(fromWallet).not.toContain('role="progressbar"');
  });

  it('draws the frame of the handoff: brand, places with their icons, and the content', () => {
    expect(html).toContain('class="frame"');
    expect(html).toContain('class="frame-brand"');
    expect(html).toContain('NX Trust');
    expect(html.match(/class="frame-nav-item"/g)).toHaveLength(SECTIONS.length);
    expect(html.match(/stroke-width="2.75"/g)?.length).toBeGreaterThanOrEqual(SECTIONS.length);
    expect(html).toContain('class="frame-main" id="main"');
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
    expect(signedOut).toContain('NX Trust');
  });
});

describe('the administration panel', () => {
  const html = renderToStaticMarkup(
    <OperatorShell operator={{ id: 'staff-1', displayName: 'وليد الغامدي', role: 'PRICING' }}>
      {null}
    </OperatorShell>,
  );

  it('is dark, so staff never mistake it for a subscriber portal (screen 05)', () => {
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('أدمن');
  });

  it('names who is signed in and their role, never their address', () => {
    expect(html).toContain('وليد الغامدي');
    expect(html).toContain('التسعير');
    expect(html).not.toContain('staff-1');
  });

  it('lists the six places of the handoff and none of the portal', () => {
    expect(OPERATOR_SECTIONS.map((section) => section.label)).toEqual([
      'نظرة عامة',
      'المشتركون',
      'الأسعار والمنتجات',
      'إعدادات التحقق',
      'التقارير',
      'الصلاحيات والتدقيق',
    ]);
    expect(html).not.toContain('href="/customers"');
    expect(html).not.toContain('data-role="balance-card"');
  });

  it('reaches every panel screen from a place or one of its tabs', () => {
    const root = join(__dirname, '../src/app/operator/(panel)');
    const pages: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (name === 'page.tsx') {
          pages.push(`/operator/${relative(root, dir)}`.replace(/\/$/, ''));
        }
      }
    };
    walk(root);

    const reachable = new Set([
      ...OPERATOR_SECTIONS.map((section) => section.href),
      ...[SUBSCRIBER_TABS, INTEGRATION_TABS, PRICING_TABS].flat().map((tab) => tab.href),
      ...SCREEN_LINKED_PAGES,
    ]);
    const unreachable = pages.filter((page) => !page.includes('[') && !reachable.has(page));
    expect(unreachable).toEqual([]);
  });

  it('keeps every tab inside the place it belongs to', () => {
    for (const tab of [
      ...SUBSCRIBER_TABS,
      ...INTEGRATION_TABS,
      ...PRICING_TABS,
      ...SCREEN_LINKED_PAGES.map((href) => ({ href })),
    ]) {
      const owners = OPERATOR_SECTIONS.filter((section) => isInSection(tab.href, section));
      expect(
        owners.map((owner) => owner.label),
        tab.href,
      ).toHaveLength(1);
    }
  });
});

describe('the page furniture', () => {
  it('gives a screen a title, a sentence and at most one action', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="الرئيسية"
        subtitle="ما يحتاج قراراً اليوم"
        action={
          <button type="button" className="btn btn-primary">
            افتح
          </button>
        }
      />,
    );
    expect(html).toContain('data-role="page-header"');
    expect(html).toContain('<h1 class="page-title">الرئيسية</h1>');
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

describe('the stylesheets hold the layout rules that are easy to break', () => {
  const sheet = (name: string): string =>
    readFileSync(fileURLToPath(new URL(`../src/styles/${name}`, import.meta.url)), 'utf8');
  const product = sheet('product.css');

  it('keeps one long table from pushing every screen sideways', () => {
    // A flex item is as wide as its widest child unless it is told otherwise.
    expect(product).toMatch(/\.frame-main \{[^}]*min-inline-size: 0;/);
    expect(product).toMatch(/\.table-scroll \{[^}]*overflow-x: auto;/);
  });

  it('makes focus visible, because this screen is worked by keyboard under audit', () => {
    expect(sheet('organic.css')).toContain(
      ':focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }',
    );
    // The checkbox hides its input, so its drawn box carries the ring instead.
    expect(product).toMatch(
      /\.check input:focus-visible \+ \.box \{\s*outline: 2px solid var\(--color-accent\);/,
    );
  });

  it('keeps the sidebar in view without a scroll container that would break it', () => {
    expect(product).toMatch(/\.frame \{[^}]*overflow: clip;/);
    expect(product).toMatch(/\.frame-sidebar-inner \{[^}]*position: sticky;/);
  });

  it('prints the evidence and not the furniture', () => {
    const print = product.slice(product.indexOf('@media print'));
    expect(print).toContain('.frame-sidebar');
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
  const field = (
    fieldPath: string,
    freshness: 'fresh' | 'expired' = 'fresh',
  ): ProfileFieldView => ({
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
          {
            fieldPath: 'account.ownership',
            severity: 'WARNING',
            detectedAt: new Date('2026-09-01'),
          },
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
    expect(html).toContain('حقول موثّقة');
    expect(html).toContain('آخر تحقق');
    // The tab links carry no script: they work behind a locked down browser and survive
    // a refresh.
    expect(html).toContain('href="/customers/e1?tab=BANKING"');
  });

  it('draws the score and says in words what it means', () => {
    const html = render();
    expect(html).toContain('data-role="trust-dial"');
    // A band, not a bare number. Colour is not a label, and this screen gets printed.
    expect(html).toMatch(/data-band="(STRONG|ADEQUATE|THIN|INSUFFICIENT)"/);
    // The arc carries a text alternative, because a reader who cannot see it still has
    // to be able to read the file.
    expect(html).toContain('aria-label="درجة الثقة');
    expect(html).toContain('data-role="coverage"');
  });

  it('says how current the open group is before showing its facts', () => {
    const html = render();
    expect(html).toContain('data-role="group-coverage"');
  });

  it('gives the coverage bar a segment with height to draw', () => {
    // The bar lives in a row that centres its children, and a span with no text has no
    // height to centre: without stretching it the bar renders as an empty groove that
    // says nothing while claiming to.
    const html = render();
    expect(html).toMatch(/data-role="coverage"[\s\S]*?align-self:stretch/);
  });
});

describe('the profile a third party sees', () => {
  const render = (openGroups: string[] = ['REGISTRY']) =>
    renderToStaticMarkup(
      <SharedProfile
        view={{
          displayName: 'مؤسسة نماء للمقاولات',
          entityType: 'BUSINESS',
          identifiers: [{ idType: 'UNN', masked: '••••••2184' }],
          score: 88,
          openGroups: openGroups as never,
          sharedBy: 'شركة العميل التجريبية',
          expiresAt: new Date('2026-10-12T00:00:00Z'),
          fields: [
            {
              fieldPath: 'cr.status',
              value: 'ACTIVE',
              authority: 'Commercial Registry',
              observedAt: new Date('2026-09-12T00:00:00Z'),
              effectiveUntil: new Date('2026-12-11T00:00:00Z'),
              freshness: 'fresh',
              confidence: 1,
            },
            {
              fieldPath: 'iban.bank',
              value: 'SA44••••1234',
              authority: 'Confirmation of Payee',
              observedAt: new Date('2026-09-12T00:00:00Z'),
              effectiveUntil: null,
              freshness: 'fresh',
              confidence: 1,
            },
          ],
        }}
      />,
    );

  it('shows only the groups the link opened', () => {
    const html = render(['REGISTRY']);
    expect(html).toContain('حالة السجل التجاري');
    // The banking fact exists on the entity and was not shared, so it is not rendered.
    expect(html).not.toContain('SA44');
  });

  it('names what was withheld rather than leaving a silent gap', () => {
    const html = render(['REGISTRY']);
    // A reader who cannot tell "no bank account" from "the bank account was not shared
    // with you" will assume the first, and act on it.
    expect(html).toContain('data-role="withheld"');
    expect(html).toContain('الحسابات البنكية');
  });

  it('offers a reader with no account nothing to click', () => {
    const html = render(['REGISTRY', 'BANKING']);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<form');
    // And no way into the console, which they cannot enter.
    expect(html).not.toContain('href="/customers"');
    expect(html).not.toContain('href="/dashboard"');
  });

  it('carries the authority on every fact and never the provider', () => {
    const html = render(['REGISTRY', 'BANKING']);
    expect(html).toContain('Commercial Registry');
    for (const provider of ['wathq', 'lean', 'stub', 'واثق', 'لين']) {
      expect(html.toLowerCase()).not.toContain(provider.toLowerCase());
    }
  });

  it('shows the identifier masked and says when the link dies', () => {
    const html = render();
    expect(html).toContain('••••••2184');
    expect(html).not.toContain('7001272184');
    expect(html).toContain('2026-10-12');
  });
});

/** Actions the rendered forms never run: these tests read markup, not behaviour. */
const noAccount = async (): Promise<IssuedPasswordState> => ({ account: null, refusalAr: null });
const noKey = async (): Promise<IssuedKeyState> => ({ secret: null });

describe('administering people', () => {
  const render = (activeAdmins: number) =>
    renderToStaticMarkup(
      <UserAdmin
        activeAdmins={activeAdmins}
        users={[
          {
            userId: 'u1',
            email: 'admin@acme.sa',
            displayName: 'مسؤول',
            role: 'ADMIN',
            status: 'active',
            isSelf: true,
          },
          {
            userId: 'u2',
            email: 'analyst@acme.sa',
            displayName: 'محلل',
            role: 'ANALYST',
            status: 'active',
            isSelf: false,
          },
          {
            userId: 'u3',
            email: 'leaver@acme.sa',
            displayName: 'مغادر',
            role: 'VIEWER',
            status: 'disabled',
            isSelf: false,
          },
        ]}
        createAction={noAccount}
        roleAction="/r"
        statusAction="/s"
      />,
    );

  it('offers nobody a way to disable their own account', () => {
    const html = render(2);
    // The row for the person looking at the screen says "you" and carries no control.
    expect(html).toContain('data-role="self"');
    const selfRow = html.slice(html.indexOf('u1'), html.indexOf('u2'));
    expect(selfRow).not.toContain('disable-user');
  });

  it('locks the last administrator in place, and says why', () => {
    const html = render(1);
    expect(html).toContain('data-role="last-admin"');
    // A workspace with no administrator cannot appoint one, so the control is disabled
    // rather than left to fail when pressed.
    expect(html).toContain('disabled=""');
  });

  it('offers a disabled account a way back', () => {
    const html = render(2);
    expect(html).toContain('data-role="enable-user"');
  });

  it('shows a temporary password once and says it will not be shown again', () => {
    const html = renderToStaticMarkup(
      <IssuedPassword email="new@acme.sa" password="nx-temporary-value" />,
    );
    expect(html).toContain('nx-temporary-value');
    expect(html).toContain('لن تُعرض مرة أخرى');
  });

  it('keeps that password out of the address it came back through (SEC-10)', () => {
    // The screen reads no search parameter at all: the password is the result of the action.
    const screen = readFileSync(
      fileURLToPath(new URL('../src/app/(app)/settings/page.tsx', import.meta.url)),
      'utf8',
    );
    expect(screen).not.toContain('searchParams');
    const actions = readFileSync(
      fileURLToPath(new URL('../src/app/(app)/settings/actions.ts', import.meta.url)),
      'utf8',
    );
    expect(actions).not.toMatch(/redirect\([^)]*password/);
  });
});

describe('putting money in', () => {
  const issued = {
    id: 't1',
    reference: 'TOP-2026-000004',
    amountHalalas: 1_000_00,
    totalWithVatHalalas: 1_150_00,
    status: 'REQUESTED' as const,
    requestedAt: new Date('2026-09-12T00:00:00Z'),
    vatInvoiceId: null,
    note: null,
  };

  it('shows the amount to send with VAT on it, not the amount without', () => {
    const html = renderToStaticMarkup(
      <TopUpPanel
        requests={[issued]}
        issued={issued}
        bank={{ accountName: 'شركة', bankName: 'بنك', iban: 'SA0000000000000000000000' }}
        requestAction="/t"
      />,
    );
    // Showing the figure without VAT beside bank details produces transfers that are
    // fifteen percent short, every time.
    expect(html).toContain('1150.00');
    expect(html).toContain('TOP-2026-000004');
    expect(html).toContain('SA0000000000000000000000');
  });

  it('says so when the bank details are not configured', () => {
    const html = renderToStaticMarkup(
      <TopUpPanel
        requests={[]}
        issued={issued}
        bank={{ accountName: null, bankName: null, iban: null }}
        requestAction="/t"
      />,
    );
    // Better than printing an address that is not ours.
    expect(html).toContain('data-role="bank-unknown"');
  });

  it('will not let staff confirm a transfer without its tax invoice', () => {
    const html = renderToStaticMarkup(
      <PendingTopUps
        pending={[{ ...issued, tenantId: 'w1', tenantName: 'شركة العميل' }]}
        confirmAction="/c"
        rejectAction="/r"
      />,
    );
    expect(html).toContain('data-role="confirm-topup"');
    // VAT falls due when credit is bought, so the number is required at the moment of
    // confirming rather than chased afterwards.
    // The whole tag, whatever order the renderer puts the attributes in.
    const tag = html.slice(
      html.lastIndexOf('<input', html.indexOf('name="vat_invoice_id"')),
      html.indexOf('/>', html.indexOf('name="vat_invoice_id"')) + 2,
    );
    expect(tag).toContain('required');
  });
});

describe('deployment readiness on screen', () => {
  const ready = {
    id: 'bank',
    titleAr: 'حساب التحويل',
    state: 'ok' as const,
    detailAr: 'مضبوط.',
    fixAr: null,
  };
  const checks = [
    ready,
    {
      id: 'mail',
      titleAr: 'تسليم البريد',
      state: 'warn' as const,
      detailAr: 'لا نقطة تسليم.',
      fixAr: 'NX_MAIL_ENDPOINT',
    },
    {
      id: 'keys',
      titleAr: 'خدمة المفاتيح',
      state: 'blocked' as const,
      detailAr: 'المفتاح من متغيّر بيئة.',
      fixAr: 'NX_KMS_ENDPOINT',
    },
  ];

  it('puts what stops a launch above what merely passes', () => {
    const html = renderToStaticMarkup(<OperatorReadiness checks={checks} canServeLive={false} />);
    // A screen that puts nine green rows above the one red one is a screen where the red
    // one is found last.
    expect(html.indexOf('data-check="keys"')).toBeLessThan(html.indexOf('data-check="mail"'));
    expect(html.indexOf('data-check="mail"')).toBeLessThan(html.indexOf('data-check="bank"'));
  });

  it('says plainly whether real customers can be served', () => {
    const stopped = renderToStaticMarkup(
      <OperatorReadiness checks={checks} canServeLive={false} />,
    );
    expect(stopped).toContain('data-ready="no"');

    const allGood = renderToStaticMarkup(<OperatorReadiness checks={[ready]} canServeLive />);
    expect(allGood).toContain('data-ready="yes"');
  });

  it('gives every row that is not ready the exact thing to set', () => {
    const html = renderToStaticMarkup(<OperatorReadiness checks={checks} canServeLive={false} />);
    expect(html).toContain('NX_KMS_ENDPOINT');
    expect(html).toContain('NX_MAIL_ENDPOINT');
  });
});

describe('the customer file over time', () => {
  it('keeps the values a field had before, with the day each was read', () => {
    const html = renderToStaticMarkup(
      <FieldCard
        field={{
          fieldPath: 'cr.status',
          value: 'SUSPENDED',
          authority: 'Commercial Registry',
          observedAt: new Date('2026-09-12T00:00:00Z'),
          effectiveUntil: new Date('2026-12-11T00:00:00Z'),
          freshness: 'fresh',
          confidence: 1,
          history: [
            {
              value: 'ACTIVE',
              authority: 'Commercial Registry',
              observedAt: new Date('2026-06-01T00:00:00Z'),
              changed: true,
            },
          ],
        }}
        now={new Date('2026-09-12T00:00:00Z')}
      />,
    );

    // The new verification did not erase the old value, and the screen proves it.
    expect(html).toContain('data-role="field-history"');
    expect(html).toContain('ACTIVE');
    expect(html).toContain('2026-06-01');
    expect(html).toContain('data-role="history-changed"');
  });

  it('shows no history drawer on a field verified once', () => {
    const html = renderToStaticMarkup(
      <FieldCard
        field={{
          fieldPath: 'cr.capital',
          value: 500000,
          authority: 'Commercial Registry',
          observedAt: new Date('2026-09-12T00:00:00Z'),
          effectiveUntil: null,
          freshness: 'permanent',
          confidence: 1,
          history: [],
        }}
      />,
    );
    // An empty drawer promises a history that does not exist.
    expect(html).not.toContain('data-role="field-history"');
  });

  it('groups the timeline by verification and names what each one did', () => {
    const html = renderToStaticMarkup(
      <VerificationHistory
        entries={[
          {
            runId: 'r2',
            reference: 'VRF-2026-000002',
            productNameAr: 'التحقق الشامل للمنشأة',
            at: new Date('2026-09-12T00:00:00Z'),
            decision: 'REVIEW',
            triggeredBy: 'MONITOR',
            fields: [
              { fieldPath: 'cr.status', value: 'SUSPENDED', kind: 'changed' },
              { fieldPath: 'cr.capital', value: 500000, kind: 'confirmed' },
            ],
          },
          {
            runId: 'r1',
            reference: 'VRF-2026-000001',
            productNameAr: 'التحقق الشامل للمنشأة',
            at: new Date('2026-06-01T00:00:00Z'),
            decision: 'PASS',
            triggeredBy: 'API',
            fields: [{ fieldPath: 'cr.status', value: 'ACTIVE', kind: 'new' }],
          },
        ]}
      />,
    );

    expect(html).toContain('VRF-2026-000002');
    expect(html).toContain('1 حقلاً تغيّر');
    // A monitor sweep and a person pressing a button are not the same event.
    expect(html).toContain('مراقبة دورية');
    // A field read again and found identical is shown, not hidden: a clean
    // re-verification must not look like nothing happened.
    expect(html).toContain('مؤكَّد');
    expect(html).toContain('تغيّر');
    expect(html).toContain('جديد');
    // Newest first, the way a person reads a file.
    expect(html.indexOf('VRF-2026-000002')).toBeLessThan(html.indexOf('VRF-2026-000001'));
  });
});

describe('the notification centre', () => {
  const items = [
    {
      id: 'change:1',
      kind: 'change' as const,
      titleAr: 'تغيّر في بيانات عميل',
      detailAr: 'الحقل cr.status تغيّر منذ آخر تحقق.',
      at: new Date('2026-09-12T10:00:00Z'),
      href: '/customers/e1',
      severity: 'critical' as const,
    },
    {
      id: 'case:1',
      kind: 'review' as const,
      titleAr: 'مراجعة تنتظر قراراً',
      detailAr: null,
      at: new Date('2026-09-10T10:00:00Z'),
      href: '/customers/reviews',
      severity: 'info' as const,
    },
  ];

  it('sends every notification somewhere it can be acted on', () => {
    const html = renderToStaticMarkup(<Inbox items={items} seenAt={null} />);
    // A notification you cannot act on from makes somebody hunt for the screen it meant.
    expect(html).toContain('href="/customers/e1"');
    expect(html).toContain('href="/customers/reviews"');
  });

  it('marks what arrived after the last look, and leaves the rest readable', () => {
    const html = renderToStaticMarkup(
      <Inbox items={items} seenAt={new Date('2026-09-11T00:00:00Z')} />,
    );
    // The newer one is marked, the older one is not. The attributes sit in one tag, so
    // the slice starts at the kind and reads forward.
    const newer = html.indexOf('data-kind="change"');
    const older = html.indexOf('data-kind="review"');
    expect(html.slice(newer, newer + 80)).toContain('data-unread="yes"');
    expect(html.slice(older, older + 80)).toContain('data-unread="no"');
    // Seen is not deleted: the older one is still on the list.
    expect(html).toContain('مراجعة تنتظر قراراً');
    expect(html).toContain('data-unread="no"');
  });

  it('puts a number on the bell rather than a dot', () => {
    // "Something happened" makes a person open it to find out whether it matters. A
    // number lets them decide without leaving what they were doing.
    const some = renderToStaticMarkup(<InboxBell unread={3} />);
    expect(some).toContain('data-unread="yes"');
    expect(some).toContain('>3<');
    expect(some).toContain('aria-label="الإشعارات، 3 جديدة"');

    const none = renderToStaticMarkup(<InboxBell unread={0} />);
    expect(none).toContain('data-unread="no"');
    expect(none).not.toContain('data-role="inbox-count"');
  });

  it('says nothing is waiting in a way that reads as good news', () => {
    const html = renderToStaticMarkup(<Inbox items={[]} seenAt={null} />);
    expect(html).toContain('لا شيء ينتظرك');
  });
});

describe('the trust band', () => {
  it('never describes the subject, only what we know about it', async () => {
    const { trustBands } = await import('@nx-verify/core');
    for (const band of trustBands()) {
      // A freshness measure published as a verdict on a company is an opinion this
      // platform is not licensed to publish. Every label is about our knowledge.
      expect(band.labelAr).toContain('معرفة');
    }
  });

  it('puts a score in exactly one band, at every boundary', async () => {
    const { trustBandFor } = await import('@nx-verify/core');
    expect(trustBandFor(null)).toBeNull();
    expect(trustBandFor(100)?.band).toBe('STRONG');
    expect(trustBandFor(80)?.band).toBe('STRONG');
    expect(trustBandFor(79)?.band).toBe('ADEQUATE');
    expect(trustBandFor(60)?.band).toBe('ADEQUATE');
    expect(trustBandFor(59)?.band).toBe('THIN');
    expect(trustBandFor(35)?.band).toBe('THIN');
    expect(trustBandFor(34)?.band).toBe('INSUFFICIENT');
    expect(trustBandFor(0)?.band).toBe('INSUFFICIENT');
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
      <ApiKeys keys={keys} issueAction={noKey} revokeAction="/revoke" />,
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
    const html = renderToStaticMarkup(<IssuedKey secret="nx_live_secret" />);
    expect(html).toContain('data-role="secret-value"');
    expect(html).toContain('nx_live_secret');
    expect(html).toContain('لا يمكن عرضه مرة أخرى');
  });

  it('keeps that secret out of the address it came back through (SEC-10)', () => {
    const screen = readFileSync(
      fileURLToPath(new URL('../src/app/(app)/settings/developers/page.tsx', import.meta.url)),
      'utf8',
    );
    expect(screen).not.toContain('searchParams');
    const actions = readFileSync(
      fileURLToPath(new URL('../src/app/(app)/settings/developers/actions.ts', import.meta.url)),
      'utf8',
    );
    expect(actions).not.toMatch(/redirect\([^)]*issued/);
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
          lines: [
            { month: '2026-09', productNameAr: 'التحقق الشامل', runs: 12, amountHalalas: 52800 },
          ],
          topUps: [
            {
              at: new Date('2026-09-01T00:00:00Z'),
              amountHalalas: 1000000,
              vatInvoiceId: 'INV-77',
            },
          ],
          spentThisTermHalalas: 52800,
          extras: null,
        }}
      />,
    );

    expect(html).toContain('كشف الحساب');
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
      page={slicePage(
        [
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
        ],
        { page: 1, size: 25 },
      )}
      tallies={{ open: 1, late: 1, approved: 1 }}
      params={{}}
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
      page={slicePage(
        [
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
        ],
        { page: 1, size: 25 },
      )}
      totals={{ billedHalalas: 8000, providerCostHalalas: 5400, packageRuns: 4 }}
      params={{}}
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
          products: [{ code: 'KYB_COMPLETE', nameAr: 'التحقق الشامل' }],
        }}
        runAction="/run"
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

  it('offers a run button, and refuses in production with the reason', () => {
    const html = render(true);
    expect(html).toContain('data-role="run-playground"');
    // The refusal is the feature: a button that can spend a customer's money on a
    // curious click is a trap.
    const refused = renderToStaticMarkup(
      <Developer
        view={{
          isSandbox: false,
          apiBaseUrl: 'https://api.nx.sa',
          keyPrefix: null,
          testCases: [],
          scenarioNames: [],
          products: [{ code: 'KYB_COMPLETE', nameAr: 'التحقق الشامل' }],
          error: 'live',
        }}
        runAction="/run"
      />,
    );
    expect(refused).toContain('data-role="playground-refusal"');
    expect(refused).toContain('ليس ميزة');
  });

  it('shows the envelope an integration will receive, not an illustration of it', () => {
    const withRun = renderToStaticMarkup(
      <Developer
        view={{
          isSandbox: true,
          apiBaseUrl: 'https://api.nx.sa',
          keyPrefix: 'nx_test_ab12',
          testCases: [],
          scenarioNames: [],
          products: [{ code: 'KYB_COMPLETE', nameAr: 'التحقق الشامل' }],
          lastRun: {
            reference: 'VRF-2026-000019',
            status: 'OK',
            decision: 'PASS',
            response: { environment: 'sandbox', status: 'OK', reference: 'VRF-2026-000019' },
            latencyMs: 21,
          },
        }}
        runAction="/run"
      />,
    );

    expect(withRun).toContain('data-role="playground-result"');
    expect(withRun).toContain('VRF-2026-000019');
    expect(withRun).toContain('&quot;environment&quot;: &quot;sandbox&quot;');
  });

  it('tells a person in production that they are, without hiding the test data', () => {
    const live = render(false);
    expect(live).toContain('أنت في بيئة الإنتاج');
    expect(live).toContain('data-role="test-cases"');
    expect(live.match(/btn-primary/g)?.length).toBe(1);
  });
});

/**
 * The commercial screen: what each plan sells, and the exceptions written under it.
 */
describe('the operator packages screen', () => {
  const html = renderToStaticMarkup(
    <OperatorPackages
      packages={[
        {
          code: 'GROWTH',
          nameAr: 'النمو',
          billingModel: 'ANNUAL',
          termMonths: 12,
          includedTransactions: 12000,
          platformFeeHalalas: 0,
          status: 'active',
          products: [
            {
              productCode: 'KYB_COMPLETE',
              productNameAr: 'التحقق الشامل',
              enabled: true,
              monthlyQuota: null,
              unitPriceHalalas: 4400,
            },
          ],
        },
      ]}
      subscribers={[
        {
          tenantId: 't1',
          legalName: 'شركة العميل',
          slug: 'acme',
          isSandbox: false,
          packageCode: 'GROWTH',
          includedTransactions: 12000,
          transactionsUsed: 400,
          overrides: [
            { productCode: 'IBAN_OWNERSHIP', productNameAr: 'ملكية الآيبان', enabled: true },
          ],
        },
        {
          tenantId: 't2',
          legalName: 'شركة العميل (Sandbox)',
          slug: 'acme-sandbox',
          isSandbox: true,
          packageCode: 'SANDBOX',
          includedTransactions: null,
          transactionsUsed: 12,
          overrides: [],
        },
      ]}
      allProducts={[
        { code: 'KYB_COMPLETE', nameAr: 'التحقق الشامل' },
        { code: 'IBAN_OWNERSHIP', nameAr: 'ملكية الآيبان' },
        { code: 'PROPERTY_DEED', nameAr: 'الصك العقاري' },
      ]}
      setProductAction="/p"
      setOverrideAction="/o"
      assignAction="/a"
    />,
  );

  it('lists every module against every plan, on and off alike', () => {
    // A module absent from a plan has to be visible to be turned on, so the row exists
    // either way and says which it is.
    expect(html).toContain('data-enabled="true"');
    expect(html).toContain('data-enabled="false"');
    expect(html).toContain('الصك العقاري');
    expect(html).toContain('data-role="toggle-product"');
  });

  it('shows the exceptions beside the plans, and how many exist', () => {
    // The person writing the next exception should see how many are already written:
    // enough of them means the plans no longer describe the market.
    expect(html).toContain('data-role="override"');
    expect(html).toContain('مفعّلة استثناءً');
    expect(html).toContain('استثناءات مكتوبة');
    expect(html).toContain('data-role="add-override"');
    expect(html).toContain('data-role="clear-override"');
  });

  it('marks a sandbox workspace so nobody sells to it by mistake', () => {
    expect(html).toContain('data-sandbox="true"');
    expect(html).toContain('data-role="sandbox-tag"');
  });

  it('lets a price be set where it will actually be charged', () => {
    // The narrowest price that mentions a product wins, and it is charged: a figure that
    // is stored and shown but never billed is worse than no figure.
    expect(html).toContain('data-role="unit-price"');
    expect(html).toContain('44.00');
    expect(html).toContain('من قائمة الأسعار');
  });

  it('names the billing model in words rather than a code', () => {
    expect(billingLabel('ANNUAL')).toBe('التزام سنوي');
    expect(billingLabel('PAYG')).toBe('دفع لكل عملية');
    expect(html).toContain('التزام سنوي');
  });
});

/**
 * The log a customer's engineer opens when an integration misbehaves.
 */
describe('the request log', () => {
  const rows = [
    {
      id: '2',
      requestId: 'req_abc123',
      method: 'POST',
      route: '/v1/verifications',
      status: 403,
      latencyMs: 9,
      errorCode: 'NX-4031',
      environment: 'live',
      at: new Date('2026-09-12T10:00:00Z'),
    },
    {
      id: '1',
      requestId: 'req_def456',
      method: 'GET',
      route: '/v1/verifications/:id',
      status: 200,
      latencyMs: 4,
      errorCode: null,
      environment: 'sandbox',
      at: new Date('2026-09-12T09:59:00Z'),
    },
  ];

  const html = renderToStaticMarkup(
    <ApiLog
      page={slicePage(rows, { page: 1, size: 25 })}
      tallies={{ total: 2, failures: 1, slowestMs: 9 }}
      params={{}}
      failuresOnly={false}
    />,
  );

  it('leads with the request id, because that is what support asks for', () => {
    expect(html).toContain('req_abc123');
    expect(html).toContain('NX-4031');
    expect(html).toContain('data-failed="true"');
  });

  it('shows the route and not the address, which is also what is stored', () => {
    expect(html).toContain('/v1/verifications/:id');
    // A path carries values, and values are the one thing rule 4 keeps out of a log.
    expect(html).not.toMatch(/\/v1\/verifications\/[0-9a-f]{8}-/);
  });

  it('puts the failures one click away, and says so when there are none', () => {
    expect(html).toContain('data-role="failures-filter"');
    const empty = renderToStaticMarkup(
      <ApiLog
        page={slicePage([], { page: 1, size: 25 })}
        tallies={{ total: 0, failures: 0, slowestMs: 0 }}
        params={{}}
        failuresOnly
      />,
    );
    expect(empty).toContain('هذه أخبار جيدة');
  });

  it('says which world each call was made in', () => {
    expect(html).toContain('data-role="log-environment"');
    expect(html).toContain('إنتاج');
    expect(html).toContain('اختبار');
  });
});

/**
 * The screen support opens while the customer is still on the telephone.
 */
describe('the operator health screen', () => {
  const html = renderToStaticMarkup(
    <OperatorHealth
      windowHours={24}
      rows={[
        {
          tenantId: 't1',
          legalName: 'شركة متعثرة',
          slug: 'struggling',
          isSandbox: false,
          calls: 40,
          failures: 12,
          slowestMs: 900,
          balanceHalalas: 500,
          heldHalalas: 0,
          balanceLow: true,
          unhealthyProviders: ['wathq-example-connector'],
        },
        {
          tenantId: 't2',
          legalName: 'شركة سليمة',
          slug: 'healthy',
          isSandbox: false,
          calls: 100,
          failures: 0,
          slowestMs: 30,
          balanceHalalas: 900000,
          heldHalalas: 0,
          balanceLow: false,
          unhealthyProviders: [],
        },
      ]}
    />,
  );

  it('answers the three questions support is asked, worst row first', () => {
    expect(html).toContain('data-role="health-tiles"');
    expect(html).toContain('data-failing="true"');
    expect(html).toContain('data-role="low-balance"');
    expect(html).toContain('data-role="unhealthy-provider"');
  });

  it('is the one console screen allowed to name a provider', () => {
    // Rule 5 keeps provider names out of anything a subscriber can reach. This screen is
    // behind an operator token and an operator connection, which is the exception.
    expect(html).toContain('wathq-example-connector');
  });

  it('says plainly that it carries nothing about whom anybody verified', () => {
    expect(html).toContain('لا شيء هنا عمّن تحقّق منه أحد');
    expect(html).not.toContain('entity');
  });
});

/**
 * The reference and the support screen: the last two things a customer needs that are not
 * a verification.
 */
describe('the reference and the support screen', () => {
  const docs = renderToStaticMarkup(
    <Docs
      view={{
        apiBaseUrl: 'https://api.nx.sa',
        products: [
          {
            code: 'ADDRESS_ONLY',
            nameAr: 'التحقق من العنوان الوطني',
            subjectType: 'BUSINESS',
            inputSchema: {
              type: 'object',
              required: ['unn'],
              properties: { unn: { type: 'string' } },
            },
            allowed: true,
            refusalAr: null,
          },
          {
            code: 'INCOME_VERIFICATION',
            nameAr: 'إثبات الدخل',
            subjectType: 'BANK_ACCOUNT',
            inputSchema: { type: 'object', required: ['account_reference'] },
            allowed: false,
            refusalAr: 'هذه الوحدة غير مشمولة في باقتك.',
          },
        ],
      }}
    />,
  );

  it('prints the schema the platform actually validates against', () => {
    // Documentation written beside a catalogue that changes is documentation that lies,
    // and the customer finds out through a 422 the page said was impossible.
    expect(docs).toContain('data-role="schema"');
    expect(docs).toContain('account_reference');
    expect(docs).toContain('الحقول المطلوبة: unn');
  });

  it('shows a module the package excludes, and says so rather than hiding it', () => {
    expect(docs).toContain('غير مشمولة في باقتك');
    expect(docs).toContain('data-role="doc-refusal"');
  });

  it('says the response names the authority and never the provider', () => {
    expect(docs).toContain('data-role="authority-note"');
    expect(docs).toContain('ولا تحمل الاستجابة اسم أي مزوّد');
  });

  it('asks support questions to bring the request id, and never an identifier', () => {
    const support = renderToStaticMarkup(
      <Support
        view={{
          supportTier: 'PRIORITY',
          packageNameAr: 'النمو',
          email: 'support@nx.sa',
          responseHours: 4,
        }}
      />,
    );

    expect(support).toContain('data-role="bring-request-id"');
    expect(support).toContain('request_id');
    // The one instruction that protects the customer from us as much as from themselves.
    expect(support).toContain('data-role="never-send"');
    expect(support).toContain('لا ترسل رقم هوية');
    expect(supportTierLabel('DEDICATED')).toBe('دعم مخصّص');
  });
});

/**
 * Where a provider is connected, and where a credential is refused rather than half saved.
 */
describe('the integration screen in the administration panel', () => {
  const base: IntegrationView = {
    environment: 'sandbox',
    baseUrl: 'https://sandbox.example.com',
    authUrl: 'https://auth.sandbox.example.com/oauth2/token',
    credential: {
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      fields: { clientId: { masked: 'fd62a5…8ffe' }, clientSecret: { fingerprint: '3fa2c1d0' } },
    },
    webhook: {
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      fields: { webhookSecret: { fingerprint: '9b1e44aa' } },
    },
    callbackUrl: 'https://api.example.sa/v1/callbacks/9Qb7rk_t0Xz',
    callbackHeader: 'x-nx-provider-signature',
    callbackAlgorithm: 'sha256',
    lastTest: null,
    changes: [
      {
        at: new Date('2026-09-12T08:30:00Z'),
        byName: 'وليد الغامدي',
        action: 'credentials.saved',
        fields: ['clientSecret'],
      },
    ],
    secretsWritable: true,
    notice: null,
    error: null,
  };
  const render = (overrides: Partial<IntegrationView> = {}) =>
    renderToStaticMarkup(
      <OperatorIntegration
        view={{ ...base, ...overrides }}
        saveAction="/s"
        testAction="/t"
        callbackAction="/k"
      />,
    );

  it('keeps one primary button, for the environment in front of the person', () => {
    const html = render();
    expect(html.match(/class="btn btn-primary"/g)?.length).toBe(1);
    expect(html).toContain('href="/operator/verification/integration?env=sandbox"');
    expect(html).toContain('href="/operator/verification/integration?env=live"');
  });

  it('takes secrets and gives none back: a fingerprint and a masked id only', () => {
    const html = render();
    expect(html).toContain('type="password"');
    expect(html).toContain('3fa2c1d0');
    expect(html).toContain('fd62a5…8ffe');
    // Inputs start empty. A secret value in a defaultValue would be a secret on the page.
    expect(html).not.toMatch(/name="client_secret"[^>]*value="/);
    expect(html).not.toMatch(/name="webhook_secret"[^>]*value="/);
  });

  it('names no data source anywhere on the screen', () => {
    const html = render();
    expect(html.toLowerCase()).not.toContain('lean');
    expect(html).not.toContain('لين');
    expect(html).not.toContain('/v1/callbacks/lean');
  });

  it('shows the callback address whole, to paste into the data source dashboard', () => {
    expect(render()).toContain('https://api.example.sa/v1/callbacks/9Qb7rk_t0Xz');
  });

  it('says what a failed test means in words a person can act on', () => {
    const html = render({
      lastTest: { at: new Date('2026-09-13T10:00:00Z'), ok: false, detail: '401' },
    });
    expect(html).toContain('data-role="test-failed"');
    expect(html).toContain('رُفضت بيانات الدخول');
  });

  it('refuses to pretend when the deployment cannot hold a secret', () => {
    const html = render({ secretsWritable: false, error: 'readonly' });
    expect(html).toContain('data-role="integration-error"');
    expect(html).toContain('NX_SECRETS_FILE');
    expect(html).toContain('disabled=""');
  });

  it('records who changed which field, by name, never the value', () => {
    const html = render();
    expect(html).toContain('وليد الغامدي');
    expect(html).toContain('حُفظت بيانات الربط');
    expect(html).toContain('السر');
  });
});
