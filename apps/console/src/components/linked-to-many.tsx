import Link from 'next/link';
import type { ReactElement } from 'react';
import { Card } from './ui/card';
import { Ltr } from './ui/ltr';
import { count } from './format';

/**
 * Who appears across several of your customers (ADR-168).
 *
 * The screen carrying the title «التقاطعات والعلاقات» never touched `entity_relations`. It
 * listed the people, accounts and properties that verifications turned up, which is genuinely
 * useful and is not what its name says. The query that answers the name was written, tested,
 * exported and called by nothing: `findEntitiesLinkedToMany`, whose own file header describes
 * it as «the reports that sell the platform: one person authorised to sign for seven
 * companies».
 *
 * This is that report. Not a risk verdict and not an accusation: a person may legitimately
 * manage four companies in a group. What it is is the thing a compliance officer would
 * otherwise have to notice by remembering a name across four separate files, which is to say
 * the thing they will not notice.
 *
 * Above the registry rather than below it, because a list of every party is a lookup and this
 * is a finding. And scoped to one subscriber like everything else: there is no cross tenant
 * version of this query and there must never be one, in code or in a report.
 */

export interface LinkedParty {
  entityId: string;
  displayName: string | null;
  entityType: string;
  linkedCount: number;
}

export interface LinkedGroup {
  relType: string;
  /** «مديراً في» and the rest, in the form the sentence needs. */
  roleAr: string;
  parties: readonly LinkedParty[];
}

export function LinkedToMany({
  groups,
  threshold,
}: {
  groups: readonly LinkedGroup[];
  /** How many companies count as several. Said on screen, since it decides what is listed. */
  threshold: number;
}): ReactElement {
  const found = groups.reduce((sum, group) => sum + group.parties.length, 0);

  return (
    <Card role="linked-to-many" labelledBy="linked-to-many-title">
      <h2 className="card-title" id="linked-to-many-title">
        أشخاص يظهرون في أكثر من عميل
      </h2>
      <p className="admin-card-note">
        من يحمل صفةً في <Ltr>{count(threshold)}</Ltr> منشآت أو أكثر من عملائك. ليس حكماً: قد
        يدير شخصٌ أربع شركات في مجموعة واحدة بلا شيء. لكنه ما لن تلاحظه وأنت تقرأ الملفات
        واحداً واحداً.
      </p>

      {found === 0 ? (
        <p className="admin-empty" data-role="linked-empty">
          لا أحد يحمل صفةً في <Ltr>{count(threshold)}</Ltr> منشآت أو أكثر من عملائك.
        </p>
      ) : (
        <div className="stack" style={{ gap: 'var(--s-3)' }}>
          {groups
            .filter((group) => group.parties.length > 0)
            .map((group) => (
              <section
                key={group.relType}
                className="stack"
                data-role="linked-group"
                data-rel={group.relType}
                style={{ gap: 'var(--s-2)' }}
              >
                <span className="stat-label">{group.roleAr}</span>
                <ul className="reason-list">
                  {group.parties.map((party) => (
                    <li
                      key={party.entityId}
                      className="reason-box"
                      data-role="linked-party"
                      data-count={party.linkedCount}
                    >
                      <span>
                        <Link href={`/customers/${party.entityId}`}>
                          {party.displayName ?? 'بلا اسم'}
                        </Link>
                      </span>
                      <span className="reason-links">
                        <Ltr>{count(party.linkedCount)}</Ltr> منشآت
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </Card>
  );
}
