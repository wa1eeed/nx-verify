import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  IssuedSigningSecret,
  Webhooks,
  eventLabelAr,
  type EndpointView,
} from '../src/components/webhooks';
import { DEVELOPER_TABS } from '../src/components/nav';
import { RulesStudio } from '../src/components/rules-studio';

/**
 * Registering an address for us to call (ADR-147).
 *
 * The delivery pipeline was complete and had nowhere to deliver: nothing in the platform
 * could register an endpoint, so the queue, the signature and the retries all ran against an
 * empty table while the tab was named for webhooks and offered only API keys.
 *
 * What is worth pinning down is the handling of the signing secret, which is the part that
 * makes a delivery provable: we generate it, it is shown once, and no screen ever carries the
 * pointer to it either.
 */

const noop = async (): Promise<void> => {};
const noIssue = async (): Promise<{ secret: null; refused: null }> => ({
  secret: null,
  refused: null,
});

const endpoint = (over: Partial<EndpointView> = {}): EndpointView => ({
  id: 'w1',
  url: 'https://api.example.sa/nx-hooks',
  events: ['verification.completed'],
  status: 'active',
  ...over,
});

const render = (endpoints: EndpointView[] = []): string =>
  renderToStaticMarkup(
    <Webhooks endpoints={endpoints} addAction={noIssue} pauseAction={noop} resumeAction={noop} />,
  );

describe('the webhooks screen', () => {
  it('is reachable, which is what it never was', () => {
    expect(DEVELOPER_TABS.map((tab) => tab.href)).toContain('/settings/developers/webhooks');
  });

  it('asks for an address and at least one event, with nothing ticked to begin with', () => {
    const html = render();
    expect(html).toContain('name="url"');
    expect(html).toContain('name="events"');
    expect(html).toContain('data-role="add-endpoint"');
    // What leaves this platform is a decision, never a default.
    expect(html).not.toContain('checked');
  });

  it('says what a payload carries, because that is what a subscriber is deciding about', () => {
    expect(render()).toContain('data-role="payload-notice"');
    expect(render()).toContain('لا تحمل معرّفاً صريحاً');
  });

  it('never puts the pointer to the signing secret on the screen', () => {
    // A `kms://` reference on a page is one lookup away from the secret it points at, and
    // the view model has no field for it at all.
    const html = render([endpoint()]);
    expect(html).not.toContain('kms://');
    expect(html).not.toContain('secret_ref');
  });

  it('shows the secret once, and says it cannot be shown again', () => {
    const html = renderToStaticMarkup(<IssuedSigningSecret secret="abc123" />);
    expect(html).toContain('data-role="secret-value"');
    expect(html).toContain('لا يُعرض مرة أخرى');
  });

  it('offers to pause a working endpoint and to start a paused one', () => {
    expect(render([endpoint()])).toContain('data-role="pause-endpoint"');
    const paused = render([endpoint({ status: 'paused' })]);
    expect(paused).toContain('data-role="resume-endpoint"');
    // And says plainly that a paused one receives nothing.
    expect(paused).toContain('ولا يُنادى');
  });

  it('says nothing is called until something is registered', () => {
    expect(render()).toContain('data-role="empty-state"');
  });

  it('names an event in Arabic rather than showing its key', () => {
    expect(eventLabelAr('verification.completed')).toBe('اكتمال تحقق');
    expect(eventLabelAr('something.new')).toBe('something.new');
  });
});

describe('the decision rules, which nothing could write', () => {
  const rules = [
    { seq: 1, description: 'السجل التجاري غير نشط', outcome: 'FAIL' as const, reasonAr: 'موقوف' },
    { seq: 2, description: 'في كل الحالات الأخرى', outcome: 'PASS' as const, reasonAr: 'مكتمل' },
  ];

  const studio = (over: Partial<Parameters<typeof RulesStudio>[0]> = {}): string =>
    renderToStaticMarkup(
      <RulesStudio
        rulesetId="rs1"
        rulesetName="افتراضي المنصة"
        isDefault
        rules={rules}
        forkAction={noop}
        setOutcomeAction={noop}
        {...over}
      />,
    );

  it('does not let the platform defaults be edited, because every workspace inherits them', () => {
    expect(studio()).not.toContain('data-role="set-outcome"');
    expect(studio()).toContain('data-role="fork-ruleset"');
  });

  it('lets a workspace move an outcome on a copy it owns', () => {
    const own = studio({ isDefault: false, rulesetName: 'قواعدنا' });
    expect(own.match(/data-role="set-outcome"/g) ?? []).toHaveLength(2);
    expect(own).toContain('name="outcome"');
  });

  it('offers no way to change what a rule looks at', () => {
    // Conditions are a closed set (ADR-031). Building one is a rule builder, not a field.
    const own = studio({ isDefault: false });
    expect(own).not.toContain('name="condition"');
    expect(own).not.toContain('name="field"');
  });

  it('offers the simulation as a link, since it writes nothing', () => {
    expect(studio()).toContain('data-role="simulate"');
    expect(studio()).toContain('simulate=1');
  });

  it('says why the defaults cannot be changed rather than only disabling a button', () => {
    expect(studio({ outcome: 'default' })).toContain('يرثها كل مشترك');
  });
});
