import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';
import { count, riyals, termPhrase } from './format';

/**
 * The first screen of the administration panel.
 *
 * Four figures for the month, then the list of things somebody should do today. The list
 * is the reason the screen exists: a renewal nobody chased and a transfer nobody
 * confirmed both cost more than any figure on this page says.
 */

export interface AttentionSubscriber {
  tenantId: string;
  legalName: string;
  daysLeft: number | null;
  availableHalalas: number;
  transactionsUsed: number;
  includedTransactions: number | null;
}

export interface OperatorOverviewView {
  subscribers: number;
  month: { runs: number; billedHalalas: number; costHalalas: number; marginPct: number | null };
  renewalsDue: AttentionSubscriber[];
  lapsed: AttentionSubscriber[];
  lowBalance: AttentionSubscriber[];
  nearCapacity: AttentionSubscriber[];
  pendingTopUps: number;
  busiest: { tenantId: string; legalName: string; runs: number; billedHalalas: number }[];
}

function SubscriberLink({ row }: { row: AttentionSubscriber }): ReactElement {
  return <a href={`/operator/tenants/${row.tenantId}`}>{row.legalName}</a>;
}

export function OperatorOverview({ view }: { view: OperatorOverviewView }): ReactElement {
  const attention =
    view.renewalsDue.length +
    view.lapsed.length +
    view.lowBalance.length +
    view.nearCapacity.length +
    (view.pendingTopUps > 0 ? 1 : 0);

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader title="نظرة عامة" subtitle="أرقام هذا الشهر، وما يحتاج متابعة اليوم." />

      <section className="grid" data-role="month-figures">
        <article className="stat">
          <span className="stat-label">المشتركون</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {count(view.subscribers)}
            </bdi>
          </strong>
          <span className="stat-hint">بلا بيئات الاختبار</span>
        </article>
        <article className="stat">
          <span className="stat-label">عمليات التحقق هذا الشهر</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {count(view.month.runs)}
            </bdi>
          </strong>
        </article>
        <article className="stat">
          <span className="stat-label">الإيراد هذا الشهر</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {riyals(view.month.billedHalalas)}
            </bdi>
          </strong>
          <span className="stat-hint">ريال، بلا ضريبة</span>
        </article>
        <article className="stat">
          <span className="stat-label">الهامش الإجمالي</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {view.month.marginPct === null ? 'لا إيراد' : `${view.month.marginPct}%`}
            </bdi>
          </strong>
          <span className="stat-hint">
            التكلفة{' '}
            <bdi dir="ltr" className="mono">
              {riyals(view.month.costHalalas)}
            </bdi>{' '}
            ريال
          </span>
        </article>
      </section>

      <Panel title="يحتاج متابعة" aside={attention === 0 ? 'لا شيء' : `${attention}`} role="attention">
        {attention === 0 ? (
          <div className="panel-body">
            <EmptyState>لا اشتراك ينتهي قريباً، ولا رصيد منخفض، ولا حوالة تنتظر.</EmptyState>
          </div>
        ) : (
          <ul className="panel-body stack attention-list" style={{ margin: 0 }}>
            {view.pendingTopUps > 0 ? (
              <li data-kind="topups">
                <a href="/operator/topups">
                  {view.pendingTopUps === 1
                    ? 'حوالة واحدة بانتظار تأكيد وصولها'
                    : `${view.pendingTopUps} حوالات بانتظار تأكيد وصولها`}
                </a>
              </li>
            ) : null}
            {view.lapsed.map((row) => (
              <li key={`lapsed-${row.tenantId}`} data-kind="lapsed">
                <SubscriberLink row={row} />{' '}
                <span className="badge" data-tone="critical">
                  {termPhrase(row.daysLeft ?? 0)}
                </span>
              </li>
            ))}
            {view.renewalsDue.map((row) => (
              <li key={`renewal-${row.tenantId}`} data-kind="renewal">
                <SubscriberLink row={row} /> <span className="muted">{termPhrase(row.daysLeft ?? 0)}</span>
              </li>
            ))}
            {view.lowBalance.map((row) => (
              <li key={`low-${row.tenantId}`} data-kind="low-balance">
                <SubscriberLink row={row} />{' '}
                <span className="muted">
                  رصيد منخفض:{' '}
                  <bdi dir="ltr" className="mono">
                    {riyals(row.availableHalalas)}
                  </bdi>{' '}
                  ريال
                </span>
              </li>
            ))}
            {view.nearCapacity.map((row) => (
              <li key={`capacity-${row.tenantId}`} data-kind="capacity">
                <SubscriberLink row={row} />{' '}
                <span className="muted">
                  استخدم{' '}
                  <bdi dir="ltr" className="mono">
                    {count(row.transactionsUsed)}
                  </bdi>{' '}
                  من{' '}
                  <bdi dir="ltr" className="mono">
                    {count(row.includedTransactions ?? 0)}
                  </bdi>{' '}
                  عملية في باقته
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="الأكثر استخداماً هذا الشهر" role="busiest">
        {view.busiest.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لم تُشغَّل أي عملية تحقق هذا الشهر بعد.</EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>المشترك</th>
                  <th>العمليات</th>
                  <th>الإيراد (ريال)</th>
                </tr>
              </thead>
              <tbody>
                {view.busiest.map((row) => (
                  <tr key={row.tenantId}>
                    <td>
                      <a href={`/operator/tenants/${row.tenantId}`}>{row.legalName}</a>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {count(row.runs)}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {riyals(row.billedHalalas)}
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
