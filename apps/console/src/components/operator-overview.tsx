import Link from 'next/link';
import type { ReactElement } from 'react';
import { LinkedRows } from './ui/linked-rows';
import { EmptyState, PageHeader, Panel } from './page-header';
import { count, riyals, termPhrase } from './format';

/**
 * The first screen of the administration panel.
 *
 * Four figures for the month, then the list of things somebody should do today. The list
 * is the reason the screen exists: a renewal nobody chased and a transfer nobody
 * confirmed both cost more than any figure on this page says.
 *
 * The two money figures say what they are made of, because for a long time they did not. «الإيراد
 * هذا الشهر» was `margin_counters.billed_halalas`, which is what wallets were charged and nothing
 * else: a plan fee, a bundle sale and a free re check all add zero to it, while the provider cost
 * of the work they bought is counted in full. A subscriber on a plan therefore read as «لا إيراد»
 * with real cost against them, and the margin under it was not the platform's margin but the
 * margin of one of the four ways it is paid. Whichever of the two the page hands over, the tile
 * now names it.
 */

export interface AttentionSubscriber {
  tenantId: string;
  legalName: string;
  daysLeft: number | null;
  availableHalalas: number;
  transactionsUsed: number;
  includedTransactions: number | null;
}

/** `RevenueBreakdown` (packages/core/src/billing/margin.ts), as this screen needs it. */
export interface MonthRevenueView {
  walletHalalas: number;
  bundleHalalas: number;
  planFeeHalalas: number;
  totalHalalas: number;
}

export interface OperatorOverviewView {
  subscribers: number;
  month: {
    runs: number;
    /** Wallet charged runs only. Not the month's revenue. */
    billedHalalas: number;
    /** Every run's provider cost, including runs a plan or a bundle had already paid for. */
    costHalalas: number;
    /** On `billedHalalas`, so it understates by the whole of the plan and bundle income. */
    marginPct: number | null;
    /**
     * The month's revenue by mechanism, from `platformMonth`. Optional only because the page
     * that builds this view has yet to read it; when it is here the tiles show the platform's
     * revenue and the platform's margin instead of the wallet's.
     */
    revenue?: MonthRevenueView | undefined;
    /** Of `runs`, the ones a plan or a bundle had already paid for. */
    coveredRuns?: number | undefined;
  };
  renewalsDue: AttentionSubscriber[];
  lapsed: AttentionSubscriber[];
  lowBalance: AttentionSubscriber[];
  nearCapacity: AttentionSubscriber[];
  pendingTopUps: number;
  busiest: { tenantId: string; legalName: string; runs: number; billedHalalas: number }[];
}

function SubscriberLink({ row }: { row: AttentionSubscriber }): ReactElement {
  return <Link href={`/operator/subscribers/${row.tenantId}`}>{row.legalName}</Link>;
}

function Money({ halalas }: { halalas: number }): ReactElement {
  return (
    <bdi dir="ltr" className="mono">
      {riyals(halalas)}
    </bdi>
  );
}

export function OperatorOverview({ view }: { view: OperatorOverviewView }): ReactElement {
  const attention =
    view.renewalsDue.length +
    view.lapsed.length +
    view.lowBalance.length +
    view.nearCapacity.length +
    (view.pendingTopUps > 0 ? 1 : 0);

  const revenue = view.month.revenue;
  const revenueHalalas = revenue?.totalHalalas ?? view.month.billedHalalas;
  // Recomputed rather than taken from the view: a margin printed beside a revenue it was not
  // divided by is the whole defect this screen is being corrected for.
  const marginPct =
    revenue === undefined
      ? view.month.marginPct
      : revenue.totalHalalas === 0
        ? null
        : Math.round(((revenue.totalHalalas - view.month.costHalalas) / revenue.totalHalalas) * 100);

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
          {view.month.coveredRuns === undefined ? null : (
            <span className="stat-hint" data-role="covered-runs">
              منها{' '}
              <bdi dir="ltr" className="mono">
                {count(view.month.coveredRuns)}
              </bdi>{' '}
              غطّتها باقة أو حزمة، دُفعت يوم شُريت
            </span>
          )}
        </article>
        <article className="stat" data-role="month-revenue">
          <span className="stat-label">
            {revenue === undefined ? 'المحصّل من الأرصدة هذا الشهر' : 'الإيراد هذا الشهر'}
          </span>
          <strong className="stat-value">
            <Money halalas={revenueHalalas} />
          </strong>
          {revenue === undefined ? (
            <span className="stat-hint" data-role="revenue-basis">
              ريال، بلا ضريبة · ما خُصم من أرصدة المشتركين فقط. رسوم الباقات وبيع الحزم ليست فيه.
            </span>
          ) : (
            <span className="stat-hint" data-role="revenue-basis">
              ريال، بلا ضريبة · أرصدة <Money halalas={revenue.walletHalalas} /> · باقات{' '}
              <Money halalas={revenue.planFeeHalalas} /> · حزم{' '}
              <Money halalas={revenue.bundleHalalas} />
            </span>
          )}
        </article>
        <article className="stat" data-role="month-margin">
          <span className="stat-label">
            {revenue === undefined ? 'الهامش على المحصّل من الأرصدة' : 'الهامش الإجمالي'}
          </span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {marginPct === null ? 'لا إيراد' : `${marginPct}%`}
            </bdi>
          </strong>
          <span className="stat-hint" data-role="margin-basis">
            {revenue === undefined ? (
              <>
                التكلفة <Money halalas={view.month.costHalalas} /> ريال، وهي تكلفة كل العمليات بما
                فيها ما غطّته الباقات والحزم. فالنسبة أدنى مما تكسبه المنصة فعلاً.
              </>
            ) : (
              <>
                الإيراد كاملاً ناقص تكلفة المزودين <Money halalas={view.month.costHalalas} /> ريال،
                مقسوماً على الإيراد كاملاً
              </>
            )}
          </span>
        </article>
      </section>

      <Panel
        title="يحتاج متابعة"
        aside={attention === 0 ? 'لا شيء' : `${attention}`}
        role="attention"
      >
        {attention === 0 ? (
          <div className="panel-body">
            <EmptyState>لا اشتراك ينتهي قريباً، ولا رصيد منخفض، ولا حوالة تنتظر.</EmptyState>
          </div>
        ) : (
          <ul className="panel-body stack attention-list" style={{ margin: 0 }}>
            {view.pendingTopUps > 0 ? (
              <li data-kind="topups">
                <Link href="/operator/subscribers/topups">
                  {view.pendingTopUps === 1
                    ? 'حوالة واحدة بانتظار تأكيد وصولها'
                    : `${view.pendingTopUps} حوالات بانتظار تأكيد وصولها`}
                </Link>
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
                <SubscriberLink row={row} />{' '}
                <span className="muted">{termPhrase(row.daysLeft ?? 0)}</span>
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
              <LinkedRows>
                {view.busiest.map((row) => (
                  <tr key={row.tenantId} data-href={`/operator/subscribers/${row.tenantId}`}>
                    <td>
                      <Link
                        prefetch={false}
                        href={`/operator/subscribers/${row.tenantId}`}
                        data-row-link
                      >
                        {row.legalName}
                      </Link>
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
              </LinkedRows>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
