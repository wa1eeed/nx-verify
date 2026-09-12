import type { ReactElement } from 'react';
import { FIELD_GROUP_LABELS, fieldGroup, type FieldGroup } from '@nx-verify/core';
import { FieldCard, type ProfileFieldView } from './field-card';
import { Identifier } from './identifier';
import { TrustDial } from './trust-dial';
import { Panel } from './page-header';

/**
 * The profile as a third party sees it.
 *
 * This is not the console screen with the buttons taken off. A reader who followed a link
 * is answering one question, once, about somebody else's company, and three things follow
 * from that.
 *
 * There is no action anywhere on it. Nothing to click means nothing to explain, and a
 * reader with no account cannot be offered a button that would fail.
 *
 * Every fact carries its authority and the day it was observed, in the card itself rather
 * than in a footnote. A shared profile whose age is in small print at the bottom is a
 * shared profile that gets read as current for ever.
 *
 * And what is missing is stated. A group the sharer did not open is named as not shared
 * rather than silently absent, because a reader who cannot tell the difference between
 * "no bank account" and "the bank account was not shared with you" will assume the first.
 */

export interface SharedProfileView {
  displayName: string | null;
  entityType: string;
  /** Already masked. The full value never reaches this component (rule 4). */
  identifiers: { idType: string; masked: string }[];
  score: number | null;
  fields: ProfileFieldView[];
  /** Which groups this link opens. Everything else is named as withheld. */
  openGroups: FieldGroup[];
  sharedBy: string;
  expiresAt: Date;
  now?: Date;
}

export function SharedProfile({ view }: { view: SharedProfileView }): ReactElement {
  const open = new Set<string>(view.openGroups);
  const shown = view.fields.filter((field) => open.has(fieldGroup(field.fieldPath)));

  const byGroup = new Map<string, ProfileFieldView[]>();
  for (const field of shown) {
    const group = fieldGroup(field.fieldPath);
    byGroup.set(group, [...(byGroup.get(group) ?? []), field]);
  }

  const withheld = view.fields
    .map((field) => fieldGroup(field.fieldPath))
    .filter((group) => !open.has(group));
  const withheldGroups = [...new Set(withheld)];

  return (
    <div className="stack" data-role="shared-profile" style={{ gap: 'var(--s-5)' }}>
      <section className="card stack" data-role="shared-header" style={{ gap: 'var(--s-4)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h1 style={{ margin: 0 }}>{view.displayName ?? 'كيان بلا اسم'}</h1>
          <span
            className="badge"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-soft)' }}
          >
            {view.entityType}
          </span>
        </div>

        <div className="row" style={{ gap: 'var(--s-5)' }}>
          {view.identifiers.map((identifier) => (
            <Identifier
              key={identifier.idType}
              label={identifier.idType}
              value={identifier.masked}
            />
          ))}
        </div>

        <TrustDial score={view.score} />

        <p className="faint" data-role="provenance">
          شاركت {view.sharedBy} هذا الملف معك. ينتهي هذا الرابط في{' '}
          <bdi dir="ltr" className="mono">
            {view.expiresAt.toISOString().slice(0, 10)}
          </bdi>
          .
        </p>
      </section>

      {[...byGroup.entries()].map(([group, fields]) => (
        <Panel
          key={group}
          title={FIELD_GROUP_LABELS[group as FieldGroup] ?? group}
          aside={`${fields.length} حقلاً`}
          role={`group-${group}`}
        >
          <div className="panel-body grid">
            {fields.map((field) => (
              <FieldCard
                key={field.fieldPath}
                field={field}
                {...(view.now ? { now: view.now } : {})}
              />
            ))}
          </div>
        </Panel>
      ))}

      {shown.length === 0 ? (
        <p className="empty" data-role="nothing-shared">
          لا حقائق في المجموعات التي فُتحت لك.
        </p>
      ) : null}

      {withheldGroups.length > 0 ? (
        <section className="card" data-role="withheld">
          <p className="faint" style={{ margin: 0 }}>
            مجموعات أخرى في هذا الملف لم تُشارَك معك:{' '}
            {withheldGroups
              .map((group) => FIELD_GROUP_LABELS[group as FieldGroup] ?? group)
              .join('، ')}
            .
          </p>
        </section>
      ) : null}

      <section className="card" data-role="what-this-is">
        <p className="faint" style={{ margin: 0 }}>
          كل حقل أعلاه سُحب من جهته الرسمية في التاريخ المكتوب عليه، ولم يُدخله أحد يدوياً.
          «حديث» تعني أن الحقل ما زال داخل مدة صلاحيته، و«منتهي الصلاحية» تعني أن المعرفة
          قديمة ولا تعني وجود مشكلة.
        </p>
      </section>
    </div>
  );
}
