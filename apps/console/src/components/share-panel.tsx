import type { ReactElement } from 'react';
import { FIELD_GROUP_LABELS, type FieldGroup } from '@nx-verify/core';
import { ShareForm, type IssuedShareState } from './issued-once';

/**
 * Sharing a profile, and taking it back.
 *
 * Three things this panel insists on, each because of a way sharing goes wrong.
 *
 * The groups are chosen, and nothing is ticked to begin with. A default of everything is
 * how a bank that asked about an account ends up holding the owner's property deeds, and
 * nobody notices because the default was convenient.
 *
 * The link is shown once and then never again. There is no way to read it back, from this
 * screen or from the database, because a link that can be recovered is a link that never
 * really expires. It comes back as the result of the action that made it rather than in the
 * address of this page, which would leave it in the browser's history and in every access log
 * on the way (SEC-10).
 *
 * And every link on the list can be withdrawn from here, with the date it was opened last
 * beside it. Sharing without revoking is publishing.
 */

export interface ShareRowView {
  shareId: string;
  groups: string[];
  purpose: string | null;
  createdAt: Date;
  expiresAt: Date;
  viewCount: number;
  lastViewedAt: Date | null;
  state: 'live' | 'expired' | 'revoked';
}

const STATE_LABELS: Record<ShareRowView['state'], string> = {
  live: 'ساري',
  expired: 'انتهى',
  revoked: 'سُحب',
};

export interface SharePanelProps {
  entityId: string;
  /** Only the groups this entity actually has facts in. An empty group is not offered. */
  availableGroups: FieldGroup[];
  shares: ShareRowView[];
  createAction: (previous: IssuedShareState, formData: FormData) => Promise<IssuedShareState>;
  revokeAction: string | ((formData: FormData) => void | Promise<void>);
  /** Inside a dialog that already carries the title and the surface. */
  bare?: boolean;
}

export function SharePanel({
  entityId,
  availableGroups,
  shares,
  createAction,
  revokeAction,
  bare = false,
}: SharePanelProps): ReactElement {
  return (
    <section
      className={bare ? 'stack' : 'card stack'}
      data-role="share-panel"
      style={{ gap: 'var(--s-4)' }}
    >
      <div>
        {bare ? null : <h2 style={{ margin: 0 }}>مشاركة الملف</h2>}
        <p className="faint" style={{ margin: 0 }}>
          رابط يفتح ما تختاره من هذا الملف لطرف خارج مساحة عملك، بلا حساب ولا معرّفات صريحة.
        </p>
      </div>

      <ShareForm action={createAction}>
        <input type="hidden" name="entity_id" value={entityId} />

        <fieldset className="stack" style={{ gap: 'var(--s-2)', border: 0, padding: 0, margin: 0 }}>
          <legend className="stat-label">ما الذي يُفتح</legend>
          {availableGroups.length === 0 ? (
            <span className="muted">لا حقائق في هذا الملف بعد لمشاركتها.</span>
          ) : (
            <div className="row" style={{ gap: 'var(--s-4)', flexWrap: 'wrap' }}>
              {availableGroups.map((group) => (
                <label key={group} className="row" style={{ gap: 'var(--s-2)' }}>
                  {/* Nothing is checked by default. Sharing everything must be a decision. */}
                  <input type="checkbox" name="groups" value={group} />
                  <span>{FIELD_GROUP_LABELS[group]}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
          <label className="stack" style={{ gap: 'var(--s-1)' }}>
            <span className="stat-label">ينتهي بعد</span>
            <select name="ttl_days" defaultValue="30" style={{ width: 'auto' }}>
              <option value="7">٧ أيام</option>
              <option value="30">٣٠ يوماً</option>
              <option value="90">٩٠ يوماً</option>
            </select>
          </label>
          <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '200px' }}>
            <span className="stat-label">الغرض، لسجلك وحدك</span>
            <input name="purpose" placeholder="فتح حساب لدى بنك" />
          </label>
        </div>

        <button
          type="submit"
          className="btn btn-secondary"
          data-role="create-share"
          disabled={availableGroups.length === 0}
        >
          إصدار رابط
        </button>
      </ShareForm>

      {shares.length > 0 ? (
        <div className="table-scroll">
          <table data-role="share-list">
            <thead>
              <tr>
                <th>ما فُتح</th>
                <th>الحالة</th>
                <th>ينتهي</th>
                <th>فُتح</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shares.map((share) => (
                <tr key={share.shareId} data-state={share.state}>
                  <td>
                    {share.groups
                      .map((group) => FIELD_GROUP_LABELS[group as FieldGroup] ?? group)
                      .join('، ')}
                    {share.purpose ? <span className="faint"> · {share.purpose}</span> : null}
                  </td>
                  <td>{STATE_LABELS[share.state]}</td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {share.expiresAt.toISOString().slice(0, 10)}
                    </bdi>
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {share.viewCount}
                    </bdi>
                    {share.lastViewedAt ? (
                      <span className="faint">
                        {' '}
                        <bdi dir="ltr" className="mono">
                          {share.lastViewedAt.toISOString().slice(0, 10)}
                        </bdi>
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {share.state === 'live' ? (
                      <form action={revokeAction}>
                        <input type="hidden" name="entity_id" value={entityId} />
                        <input type="hidden" name="share_id" value={share.shareId} />
                        <button
                          type="submit"
                          className="btn btn-secondary"
                          data-role="revoke-share"
                        >
                          سحب
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
