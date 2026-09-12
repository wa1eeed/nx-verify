import type { ReactElement } from 'react';
import {
  FIELD_GROUP_LABELS,
  FIELD_GROUP_ORDER,
  fieldGroup,
  type FieldGroup,
} from '@nx-verify/core';
import { FieldCard, type ProfileFieldView } from './field-card';
import { ChangeBadge, FreshnessBadge, type FreshnessState } from './freshness';
import { Identifier } from './identifier';
import type { TimelineEntryView } from './timeline';
import { Panel } from './page-header';
import { CoverageBar, TrustDial, type CoverageCounts } from './trust-dial';

/**
 * The file of one verified entity, laid out top to bottom as docs/01-blueprint.md
 * section 5.1 specifies: header, alert, facts, action. The history lives in two places
 * that answer two different questions: each field carries the values it held before, and
 * the verification log below groups those facts by the check that produced them.
 *
 * The facts are grouped into tabs, and the grouping is by what a reader is looking for
 * rather than by which product produced them: somebody checking banking arrangements
 * wants the account, the holder and the income together, whether they arrived from one
 * product or three. A tab that carries an expired field or a detected change says so on
 * the tab itself, because the reason to group facts is to let somebody skip the groups
 * they do not need, and that only works if a group can signal that it should not be
 * skipped.
 *
 * The tabs are links rather than script. A screen that reads a compliance file has to
 * work behind a locked down browser, print correctly, and survive a page refresh with the
 * same tab open, and all three come free when the tab is in the address.
 *
 * One primary button on the screen and no more. Everything a compliance officer can do
 * here that is not "verify again" is secondary, because a screen with three equal buttons
 * is a screen where the important one gets missed.
 */

export interface EntityHeaderView {
  entityId: string;
  displayName: string | null;
  entityType: string;
  /** Already masked. The console never receives a full identifier (rule 4). */
  identifiers: { idType: string; masked: string }[];
  score: number | null;
  /**
   * How the score was reached. Never omitted when a score is shown: a number without its
   * working is refused by risk management, and showing one without the other on screen
   * would put the analyst in the same position.
   */
  scoreBreakdown: { fieldPath: string; weight: number; earned: number; freshness: string }[];
  completeness: number;
}

export interface RelationView {
  relType: string;
  otherEntityId: string;
  otherName: string | null;
  direction: 'from' | 'to';
  /** How many entities that counterparty is linked to across this tenant. */
  linkedCount: number;
}

const RELATION_LABELS: Record<string, string> = {
  MANAGES: 'يدير',
  OWNS: 'يملك',
  HOLDS_ACCOUNT: 'صاحب الحساب',
  OWNS_PROPERTY: 'يملك العقار',
  SHARES_ADDRESS: 'يشارك العنوان',
};

export interface DetectedChange {
  fieldPath: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  detectedAt: Date;
}

export interface Entity360Props {
  header: EntityHeaderView;
  fields: ProfileFieldView[];
  changes: DetectedChange[];
  /**
   * Kept for callers that still pass it, and no longer drawn here.
   *
   * A flat list of every fact ever recorded sat under a grouped list of the same facts,
   * and the page had two timelines saying the same thing in two shapes. The grouped one
   * answers the question people actually open a file with, and each field carries its own
   * previous values, so the flat one was the copy that had to go.
   */
  timeline?: TimelineEntryView[];
  relations?: RelationView[];
  /** Which group of facts is open. Absent means the first group that has any. */
  tab?: string | undefined;
  now?: Date;
}

interface GroupSummary {
  group: FieldGroup;
  label: string;
  fields: ProfileFieldView[];
  expired: number;
  changed: number;
  coverage: CoverageCounts;
}

/**
 * The tabs, derived from the facts rather than declared.
 *
 * A product added as rows (rule 8) brings its fields into the right tab without anybody
 * editing this file, and a group with nothing in it does not appear at all: an empty tab
 * is a promise the file cannot keep.
 */
function groupFields(fields: ProfileFieldView[], changed: Set<string>): GroupSummary[] {
  const byGroup = new Map<FieldGroup, ProfileFieldView[]>();
  for (const field of fields) {
    const group = fieldGroup(field.fieldPath);
    byGroup.set(group, [...(byGroup.get(group) ?? []), field]);
  }

  return FIELD_GROUP_ORDER.filter((group) => (byGroup.get(group)?.length ?? 0) > 0).map(
    (group): GroupSummary => {
      const groupFieldList = byGroup.get(group) ?? [];
      const expired = groupFieldList.filter((field) => field.freshness === 'expired').length;
      const expiring = groupFieldList.filter((field) => field.freshness === 'expiring').length;
      return {
        group,
        label: FIELD_GROUP_LABELS[group],
        fields: groupFieldList,
        expired,
        changed: groupFieldList.filter((field) => changed.has(field.fieldPath)).length,
        // Permanent fields count as current: a registration number does not go stale.
        coverage: {
          fresh: groupFieldList.length - expired - expiring,
          expiring,
          expired,
        },
      };
    },
  );
}

export function Entity360({
  header,
  fields,
  changes,
  relations = [],
  tab,
  now,
}: Entity360Props): ReactElement {
  const expired = fields.filter((field) => field.freshness === 'expired');
  const expiring = fields.filter((field) => field.freshness === 'expiring');
  const changedPaths = new Set(changes.map((change) => change.fieldPath));
  const groups = groupFields(fields, changedPaths);
  const openGroup = groups.find((group) => group.group === tab) ?? groups[0];
  const verifiedAt = fields.reduce<Date | null>(
    (latest, field) =>
      latest === null || field.observedAt > latest ? field.observedAt : latest,
    null,
  );

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <section className="card stack" data-role="header" style={{ gap: 'var(--s-4)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h1 style={{ margin: 0 }}>{header.displayName ?? 'بلا اسم'}</h1>
          <span className="badge" style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-soft)' }}>
            {header.entityType}
          </span>
        </div>

        <div className="row" style={{ gap: 'var(--s-5)' }}>
          {header.identifiers.map((identifier) => (
            <Identifier
              key={identifier.idType}
              label={identifier.idType}
              value={identifier.masked}
            />
          ))}
        </div>

        {/*
          The figures a reader checks before reading anything else, in the order they are
          checked. The score comes first and is drawn rather than printed, because it is
          the one number that decides whether the rest is worth reading. The others follow
          it and are deliberately smaller: a screen where six figures are equally loud is
          a screen where the reader picks one at random.
        */}
        <div
          className="row"
          data-role="headline"
          style={{ gap: 'var(--s-5)', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <TrustDial score={header.score} />
          <div className="stack" style={{ gap: 'var(--s-2)', minWidth: '180px' }}>
            <span className="stat-label">الاكتمال</span>
            <CoverageBar
              counts={{
                fresh: fields.length - expired.length - expiring.length,
                expiring: expiring.length,
                expired: expired.length,
              }}
            />
            <span className="stat-hint">
              <bdi dir="ltr" className="mono">
                {header.completeness}%
              </bdi>{' '}
              من الحقول المطلوبة لهذا النوع
            </span>
          </div>
        </div>

        <div className="grid" data-role="indicators" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <div className="stat">
            <span className="stat-label">حقول موثّقة</span>
            <strong className="stat-value">
              <bdi dir="ltr" className="mono">
                {fields.length}
              </bdi>
            </strong>
            <span className="stat-hint">في {groups.length} فئة</span>
          </div>
          <div className="stat" {...(expired.length > 0 ? { 'data-tone': 'expired' } : {})}>
            <span className="stat-label">منتهية الصلاحية</span>
            <strong className="stat-value">
              <bdi dir="ltr" className="mono">
                {expired.length}
              </bdi>
            </strong>
            <span className="stat-hint">تحتاج إعادة تحقق</span>
          </div>
          <div className="stat" {...(changes.length > 0 ? { 'data-tone': 'changed' } : {})}>
            <span className="stat-label">تغيّرات مرصودة</span>
            <strong className="stat-value">
              <bdi dir="ltr" className="mono">
                {changes.length}
              </bdi>
            </strong>
            <span className="stat-hint">تغيّرت منذ آخر تحقق</span>
          </div>
          <div className="stat">
            <span className="stat-label">آخر تحقق</span>
            <strong className="stat-value" style={{ fontSize: '18px' }}>
              <bdi dir="ltr" className="mono">
                {verifiedAt ? verifiedAt.toISOString().slice(0, 10) : 'لا يوجد'}
              </bdi>
            </strong>
          </div>
        </div>

        {header.score !== null && header.scoreBreakdown.length > 0 ? (
          <details data-role="score-breakdown">
            <summary className="muted">كيف حُسبت الدرجة</summary>
            <table>
              <thead>
                <tr>
                  <th>الحقل</th>
                  <th>الوزن</th>
                  <th>المحتسب</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {header.scoreBreakdown.map((component) => (
                  <tr key={component.fieldPath}>
                    <td>{component.fieldPath}</td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {component.weight}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {component.earned}
                      </bdi>
                    </td>
                    <td>
                      <FreshnessBadge state={component.freshness as FreshnessState} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : null}
      </section>

      {/*
        The alert appears only when there is something to say. Two separate reasons, kept
        visually apart: a detected change is a warning, an expired field is not.
      */}
      {changes.length > 0 ? (
        <section
          className="card stack"
          data-role="alert-changes"
          style={{ borderColor: 'var(--changed-line)', background: 'var(--changed-bg)' }}
        >
          <strong>تغيّرات مرصودة</strong>
          {changes.map((change) => (
            <div key={change.fieldPath} className="row">
              <ChangeBadge severity={change.severity} />
              <span>{change.fieldPath}</span>
              <span className="muted">
                <bdi dir="ltr" className="mono">
                  {change.detectedAt.toISOString().slice(0, 10)}
                </bdi>
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {expired.length > 0 ? (
        <section
          className="card stack"
          data-role="alert-expired"
          style={{ borderColor: 'var(--expired-line)', background: 'var(--expired-bg)' }}
        >
          <div className="row">
            <FreshnessBadge state="expired" />
            <span>
              {expired.length} حقلاً تجاوز مدة صلاحيته. المعرفة قديمة، ولا يعني ذلك وجود مشكلة.
            </span>
          </div>
        </section>
      ) : null}

      {groups.length > 0 ? (
        <nav className="tabs" data-role="profile-tabs" aria-label="مجموعات الحقائق">
          {groups.map((group) => (
            <a
              key={group.group}
              className="tab"
              href={`/entities/${header.entityId}?tab=${group.group}`}
              {...(openGroup?.group === group.group ? { 'aria-current': 'page' as const } : {})}
              data-group={group.group}
            >
              {group.label}
              <span className="muted">
                {' '}
                (<bdi dir="ltr" className="mono">{group.fields.length}</bdi>)
              </span>
              {/* A group that should not be skipped says so on the tab itself, and the
                  two states keep their own colours here as everywhere else. */}
              {group.changed > 0 ? (
                <span className="tab-dot" data-kind="changed" data-role="tab-changed" aria-label="تغيّر مرصود" />
              ) : null}
              {group.expired > 0 ? (
                <span className="tab-dot" data-kind="expired" data-role="tab-expired" aria-label="منتهي الصلاحية" />
              ) : null}
            </a>
          ))}
        </nav>
      ) : null}

      {/*
        How current this group is, before the cards themselves. A reader who opened this
        tab to answer one question gets the answer to a different one for free: whether
        what they are about to read is worth trusting.
      */}
      {openGroup ? (
        <section className="card" data-role="group-coverage" data-group={openGroup.group}>
          <div
            className="row"
            style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--s-4)' }}
          >
            <strong>{openGroup.label}</strong>
            <div style={{ minWidth: '200px' }}>
              <CoverageBar counts={openGroup.coverage} />
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid" data-role="fields">
        {(openGroup?.fields ?? []).map((field) => (
          <FieldCard key={field.fieldPath} field={field} {...(now ? { now } : {})} />
        ))}
      </section>

      {fields.length === 0 ? (
        <p className="empty" data-role="no-facts">
          لا حقائق موثقة بعد على هذا الكيان. أول تحقق يملأ هذا الملف.
        </p>
      ) : null}

      {relations.length > 0 ? (
        <Panel title="شبكة العلاقات" aside="داخل هذا المستأجر وحده" role="relations">
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>العلاقة</th>
                <th>الطرف الآخر</th>
                <th>مرتبط بـ</th>
              </tr>
            </thead>
            <tbody>
              {relations.map((relation) => (
                <tr
                  key={`${relation.relType}-${relation.otherEntityId}`}
                  data-signal={relation.linkedCount >= 3 ? 'high' : 'normal'}
                >
                  <td>{RELATION_LABELS[relation.relType] ?? relation.relType}</td>
                  <td>
                    <a href={`/entities/${relation.otherEntityId}`}>
                      {relation.otherName ?? 'بلا اسم'}
                    </a>
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {relation.linkedCount}
                    </bdi>{' '}
                    {relation.linkedCount >= 3 ? (
                      <span
                        className="badge"
                        data-kind="change"
                        style={{
                          color: 'var(--changed-fg)',
                          background: 'var(--changed-bg)',
                          borderColor: 'var(--changed-line)',
                        }}
                      >
                        إشارة شبكة
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="panel-body faint" style={{ paddingBlockStart: 0 }}>
            لا تجميع عبر العملاء، وهو حظر تعاقدي وتقني معاً.
          </p>
        </Panel>
      ) : null}

      <section className="row" data-role="actions">
        {/* The single primary action on this screen. */}
        <button
          type="submit"
          className="btn-primary"
          formAction={`/entities/${header.entityId}/verify`}
        >
          تحديث التحقق
        </button>
        <a className="btn-secondary" href={`/entities/${header.entityId}/evidence`}>
          ملف الدليل
        </a>
        <a className="btn-secondary" href={`/entities/${header.entityId}/monitor`}>
          تفعيل المراقبة
        </a>
      </section>
    </div>
  );
}
