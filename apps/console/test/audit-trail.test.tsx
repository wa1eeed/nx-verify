import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AuditTrail,
  actionLabel,
  metadataLine,
  type AuditRowView,
} from '../src/components/audit-trail';
import { SETTINGS_TABS } from '../src/components/nav';

/**
 * Reading the trail this platform has always written (ADR-150).
 *
 * `audit()` is called on dozens of paths and `readAudit` had no caller in any application, so
 * the answer to «who shared this customer's file» lived in a table nobody could open. A log
 * nobody can read is a log that does not exist for the purpose it was built for.
 */

const row = (over: Partial<AuditRowView> = {}): AuditRowView => ({
  id: '1',
  actorType: 'USER',
  actorId: '11111111-1111-1111-1111-111111111111',
  actorName: 'وليد الغامدي',
  action: 'profile.shared',
  target: 'e1',
  metadata: { groups: ['REGISTRY'], ttl_days: 30, sent_to: 'bank@example.com' },
  createdAt: new Date('2026-09-16T09:31:00Z'),
  ...over,
});

const render = (rows: AuditRowView[], actions: string[] = []): string =>
  renderToStaticMarkup(<AuditTrail rows={rows} actions={actions} />);

describe('the audit trail screen', () => {
  it('is reachable, which is what it never was', () => {
    expect(SETTINGS_TABS.map((tab) => tab.href)).toContain('/settings/audit');
  });

  it('names the person rather than showing their id', () => {
    const html = render([row()]);
    expect(html).toContain('وليد الغامدي');
    expect(html).not.toContain('11111111-1111');
  });

  it('falls back to the kind of actor where no name could be found', () => {
    expect(render([row({ actorName: null, actorType: 'SYSTEM' })])).toContain('النظام');
  });

  it('says what each action was in Arabic', () => {
    expect(actionLabel('profile.shared')).toBe('شارك ملف عميل');
    expect(actionLabel('ruleset.rule_changed')).toBe('غيّر نتيجة قاعدة');
    // An action nobody named shows its own code rather than vanishing: a trail that silently
    // drops what it cannot label has a hole exactly where something unusual happened.
    expect(actionLabel('something.new')).toBe('something.new');
  });

  it('shows the recipient of a share, which is the whole point of recording one', () => {
    expect(render([row()])).toContain('bank@example.com');
  });

  it('says out loud that the details are redacted before they are stored', () => {
    // An audit trail that leaks an identifier is itself a finding, and the screen says the
    // redaction happens on the way in rather than on the way out.
    expect(render([row()])).toContain('data-role="redaction-notice"');
    expect(render([row()])).toContain('سجلٌّ يسرّب معرّفاً هو نفسه مخالفة');
  });

  it('offers a filter of the actions this workspace actually has', () => {
    const html = render([row()], ['profile.shared', 'webhook.registered']);
    expect(html).toContain('data-role="audit-filter"');
    expect(html).toContain('سجّل عنوان webhook');
  });

  it('reads an empty trail as empty rather than as a broken table', () => {
    expect(render([])).toContain('data-role="empty-state"');
  });

  it('writes metadata as one readable line', () => {
    expect(metadataLine(null)).toBe('');
    expect(metadataLine({ seq: 1, outcome: 'REVIEW' })).toBe('seq: 1 · outcome: REVIEW');
  });
});

/**
 * A trail read years later (ADR-169).
 *
 * It asked for the last two hundred rows and printed their count beside the title, so a
 * truncated list and a complete one looked identical and a question about last quarter had no
 * answer at all.
 */
describe('reading further back', () => {
  const rows: AuditRowView[] = [
    {
      id: '1',
      actorType: 'USER',
      actorId: 'u1',
      actorName: 'وليد',
      action: 'user.created',
      target: null,
      metadata: null,
      createdAt: new Date('2026-09-18T09:00:00Z'),
    },
  ];

  it('offers a window, and keeps the action filter while changing it', () => {
    const html = renderToStaticMarkup(
      <AuditTrail rows={rows} actions={['user.created']} action="user.created" />,
    );
    expect(html).toContain('data-role="audit-window"');
    // The filter has to survive the window, or picking a month silently drops it.
    expect(html).toContain('name="action" value="user.created"');
  });

  it('says the count is a floor when there is more, and offers the next page', () => {
    const html = renderToStaticMarkup(
      <AuditTrail
        rows={rows}
        actions={[]}
        more
        nextBefore="4210"
      />,
    );
    expect(html).toContain('1+');
    expect(html).toContain('data-role="audit-older"');
    // A cursor, not an offset: the trail grows while somebody reads it. And the id, not the
    // timestamp: rows written in one transaction share one (ADR-169).
    expect(html).toContain('before=4210');
  });

  it('offers no next page when this is all there is', () => {
    const html = renderToStaticMarkup(<AuditTrail rows={rows} actions={[]} />);
    expect(html).not.toContain('data-role="audit-older"');
    expect(html).not.toContain('1+');
  });
});
