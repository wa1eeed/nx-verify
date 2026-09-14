import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';
import { ChangeBadge, FreshnessBadge, type FreshnessState } from './freshness';
import { fieldLabel } from './field-card';
import { isoDate } from './format';

/**
 * What changed since the last check, and what is about to go stale.
 *
 * Two lists and they stay apart, because they mean different things and ask for different
 * work. A detected change is news about the customer: the registry now says something it
 * did not say before, and somebody should read it. An expiring fact is news about our
 * knowledge: nothing is known to be wrong, it is simply old, and the answer is to verify
 * again. The first carries the warning colour and the second stays neutral grey, here as
 * on every other screen.
 */

export interface ChangeRowView {
  changeEventId: string;
  entityId: string;
  entityName: string | null;
  fieldPath: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  reasonAr: string | null;
  detectedAt: Date;
}

export interface StaleCustomerView {
  entityId: string;
  entityName: string | null;
  expired: number;
  expiring: number;
  /** The soonest a fact on this file stops being current. */
  soonest: Date | null;
  fields: { fieldPath: string; freshness: FreshnessState }[];
}

export function Monitoring({
  changes,
  stale,
  heading = true,
}: {
  changes: ChangeRowView[];
  stale: StaleCustomerView[];
  /** False where the screen around it already carries the page header. */
  heading?: boolean;
}): ReactElement {
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      {heading ? (
        <PageHeader
          title="المراقبة"
          subtitle="ما تغيّر في بيانات عملائك منذ آخر تحقق، والعملاء الذين قدمت معلوماتهم."
        />
      ) : null}

      <Panel
        title="تغيّرات مرصودة"
        aside={changes.length === 0 ? 'لا شيء جديد' : `${changes.length}`}
        note="التغيّر خبر عن العميل نفسه: الجهة الرسمية تقول الآن شيئاً لم تقله من قبل."
        role="changes"
      >
        {changes.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لم يُرصد أي تغيّر يحتاج اطلاعك.</EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>العميل</th>
                  <th>ما تغيّر</th>
                  <th>الأهمية</th>
                  <th>رُصد في</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((change) => (
                  <tr key={change.changeEventId} data-role="change-row">
                    <td>
                      <a href={`/customers/${change.entityId}`}>{change.entityName ?? 'بلا اسم'}</a>
                    </td>
                    <td>
                      {fieldLabel(change.fieldPath)}
                      {change.reasonAr ? <div className="faint">{change.reasonAr}</div> : null}
                    </td>
                    <td>
                      <ChangeBadge severity={change.severity} />
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {isoDate(change.detectedAt)}
                      </bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="معلومات تحتاج تحديثاً"
        aside={stale.length === 0 ? 'كلها حديثة' : `${stale.length} عميل`}
        note="انتهاء المدة لا يعني وجود مشكلة. يعني أن المعلومة قديمة وتحتاج تحققاً جديداً."
        role="stale"
      >
        {stale.length === 0 ? (
          <div className="panel-body">
            <EmptyState>كل المعلومات في ملفات عملائك ضمن مدة صلاحيتها.</EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>العميل</th>
                  <th>الحقول</th>
                  <th>أقرب انتهاء</th>
                </tr>
              </thead>
              <tbody>
                {stale.map((customer) => (
                  <tr key={customer.entityId} data-role="stale-row">
                    <td>
                      <a href={`/customers/${customer.entityId}`}>
                        {customer.entityName ?? 'بلا اسم'}
                      </a>
                    </td>
                    <td>
                      <span className="row" style={{ gap: 'var(--s-2)' }}>
                        {customer.expired > 0 ? (
                          <span>
                            <FreshnessBadge state="expired" />{' '}
                            <bdi dir="ltr" className="mono">
                              {customer.expired}
                            </bdi>
                          </span>
                        ) : null}
                        {customer.expiring > 0 ? (
                          <span>
                            <FreshnessBadge state="expiring" />{' '}
                            <bdi dir="ltr" className="mono">
                              {customer.expiring}
                            </bdi>
                          </span>
                        ) : null}
                      </span>
                      <div className="faint">
                        {customer.fields
                          .slice(0, 3)
                          .map((field) => fieldLabel(field.fieldPath))
                          .join('، ')}
                        {customer.fields.length > 3 ? ' …' : ''}
                      </div>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {customer.soonest ? isoDate(customer.soonest) : 'منتهية'}
                      </bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
