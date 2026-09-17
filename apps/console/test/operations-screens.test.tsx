import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Monitors, cadenceLabel, type MonitorRowView } from '../src/components/monitors';
import { SsoSettings, type SsoDomainView } from '../src/components/sso-settings';
import { OperatorKeys, type KeyVersionView } from '../src/components/operator-keys';
import { OperatorCallbacks, callbackStatusLabel } from '../src/components/operator-callbacks';
import { CUSTOMER_TABS, SETTINGS_TABS } from '../src/components/nav';
import { INTEGRATION_TABS } from '../src/components/operator-nav';

/**
 * The last of the dead controls (ADR-152, ADR-153).
 *
 * Four capabilities that existed in the domain and could not be reached: stopping a monitor
 * that was spending money, seeing what the data sources had called us about, declaring which
 * key version is written with, and configuring the single sign on whose form has sat on the
 * login screen of every deployment unable to work.
 */

const noop = async (): Promise<void> => {};

describe('the monitors screen', () => {
  const monitor = (over: Partial<MonitorRowView> = {}): MonitorRowView => ({
    id: 'm1',
    entityId: 'e1',
    entityName: 'مؤسسة نماء',
    productNameAr: 'السجل التجاري',
    fieldPaths: ['cr.status'],
    cadence: 'MONTHLY',
    nextRunAt: new Date('2026-10-01T00:00:00Z'),
    budgetCap: 50_000,
    spentThisPeriod: 12_000,
    status: 'active',
    ...over,
  });

  const render = (rows: MonitorRowView[]): string =>
    renderToStaticMarkup(<Monitors rows={rows} pauseAction={noop} resumeAction={noop} />);

  it('is reachable, which it never was', () => {
    expect(CUSTOMER_TABS.map((tab) => tab.href)).toContain('/customers/monitoring');
  });

  it('offers a stop on anything that is spending', () => {
    expect(render([monitor()])).toContain('data-role="pause-monitor"');
  });

  it('offers a start on a paused one', () => {
    expect(render([monitor({ status: 'paused' })])).toContain('data-role="resume-monitor"');
  });

  it('offers no button on one that ran out, because the cap is the control', () => {
    // Restarting it would stop it again on the next sweep; raising the cap resumes it.
    const html = render([monitor({ status: 'budget_exhausted' })]);
    expect(html).not.toContain('data-role="resume-monitor"');
    expect(html).toContain('ارفع السقف');
  });

  it('lists what stopped as well as what runs, since that is why somebody stopped being watched', () => {
    const html = render([monitor({ status: 'budget_exhausted' })]);
    expect(html).toContain('نفد سقف الفترة');
  });

  it('says a monitor costs real money and shows the ceiling', () => {
    const html = render([monitor()]);
    expect(html).toContain('data-role="budget-notice"');
    expect(html).toContain('500.00');
  });

  it('names a cadence in Arabic', () => {
    expect(cadenceLabel('ON_EXPIRY')).toBe('عند انتهاء الصلاحية');
    expect(cadenceLabel('SOMETHING')).toBe('SOMETHING');
  });
});

describe('the single sign on screen', () => {
  const domain = (over: Partial<SsoDomainView> = {}): SsoDomainView => ({
    domain: 'example.sa',
    verified: false,
    proofToken: 'abc123',
    checkedAt: null,
    lastError: null,
    ...over,
  });

  const render = (domains: SsoDomainView[]): string =>
    renderToStaticMarkup(
      <SsoSettings
        idp={null}
        domains={domains}
        configureAction={noop}
        claimAction={noop}
        verifyAction={noop}
        removeAction={noop}
      />,
    );

  it('is reachable, which it never was', () => {
    expect(SETTINGS_TABS.map((tab) => tab.href)).toContain('/settings/sso');
  });

  it('shows the exact record to publish, and says an unproved domain routes nobody', () => {
    const html = render([domain()]);
    expect(html).toContain('nx-verify-domain=abc123');
    expect(html).toContain('ولا يوجّه أحداً');
  });

  it('hides the switch that closes the password door until a domain is proved', () => {
    // Turning it on with a broken configuration locks a workspace out of itself.
    expect(render([domain()])).toContain('data-role="enforce-locked"');
    expect(render([domain()])).not.toContain('data-role="enforce-sso"');
    expect(render([domain({ verified: true, proofToken: null })])).toContain(
      'data-role="enforce-sso"',
    );
  });

  it('stops offering the record once the domain is proved', () => {
    expect(render([domain({ verified: true, proofToken: null })])).not.toContain(
      'data-role="proof-record"',
    );
  });

  it('never carries the pointer to the client secret to the screen', () => {
    const html = renderToStaticMarkup(
      <SsoSettings
        idp={{
          issuer: 'https://login.example.com',
          clientId: 'nx',
          hasSecret: true,
          discoveryUrl: 'https://login.example.com/.well-known/openid-configuration',
          defaultRole: null,
          allowJit: true,
          enforceSso: false,
        }}
        domains={[domain({ verified: true, proofToken: null })]}
        configureAction={noop}
        claimAction={noop}
        verifyAction={noop}
        removeAction={noop}
      />,
    );
    expect(html).not.toContain('kms://');
  });

  it('defaults an unmatched person to refusal, not to a role', () => {
    expect(render([])).toContain('ارفضه');
  });
});

describe('the key versions screen', () => {
  const version = (over: Partial<KeyVersionView> = {}): KeyVersionView => ({
    version: 1,
    status: 'active',
    activatedAt: new Date('2026-09-01T00:00:00Z'),
    retiredAt: null,
    notes: null,
    ...over,
  });

  const render = (versions: KeyVersionView[], canEdit = true): string =>
    renderToStaticMarkup(
      <OperatorKeys
        versions={versions}
        canEdit={canEdit}
        activateAction={noop}
        retireAction={noop}
      />,
    );

  it('is reachable, which it never was', () => {
    expect(INTEGRATION_TABS.map((tab) => tab.href)).toContain('/operator/verification/keys');
  });

  it('never offers to retire the version being written with', () => {
    // Retiring it makes every row it wrote unreadable, and that is not recoverable.
    const html = render([version()]);
    expect(html).not.toContain('data-role="retire-version"');
    expect(html).toContain('لا تتقاعد الفعّالة');
  });

  it('offers to retire one that is only being read', () => {
    expect(render([version({ status: 'retiring' })])).toContain('data-role="retire-version"');
  });

  it('states the order, because getting it wrong is not recoverable', () => {
    expect(render([version()])).toContain('فعّل، ثم شغّل التدوير');
  });

  it('offers nothing to a role that may not change the integration', () => {
    const html = render([version({ status: 'retiring' })], false);
    expect(html).not.toContain('data-role="retire-version"');
    expect(html).not.toContain('data-role="activate-version"');
  });
});

describe('the inbound callbacks screen', () => {
  it('is reachable, which it never was', () => {
    expect(INTEGRATION_TABS.map((tab) => tab.href)).toContain('/operator/verification/callbacks');
  });

  it('names what a callback did in Arabic', () => {
    expect(callbackStatusLabel('duplicate')).toBe('مكرر، أُهمل');
    expect(callbackStatusLabel('whatever')).toBe('whatever');
  });

  it('reads an empty list as empty', () => {
    expect(renderToStaticMarkup(<OperatorCallbacks rows={[]} />)).toContain(
      'data-role="empty-state"',
    );
  });
});
