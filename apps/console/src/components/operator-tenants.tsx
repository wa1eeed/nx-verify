import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';
import { count, isoDate, riyals, termPhrase } from './format';

/**
 * The subscribers, and one subscriber.
 *
 * The list answers the three questions a person running the platform brings to it: which
 * package, until when, and how much of it is left. Capacity and balance are both shown
 * because a subscriber runs out of whichever comes first, and a list that shows one of
 * them invites a phone call about the other.
 *
 * Nothing here is about a company a subscriber verified. The figures come from the
 * commitment, the wallet and the counters, which is all this panel may read.
 */

export interface TenantRowView {
  tenantId: string;
  legalName: string;
  slug: string;
  packageNameAr: string | null;
  termEnd: Date | null;
  daysLeft: number | null;
  includedTransactions: number | null;
  transactionsUsed: number;
  availableHalalas: number;
  lowBalance: boolean;
  hasSandbox: boolean;
}

function TermCell({
  termEnd,
  daysLeft,
}: {
  termEnd: Date | null;
  daysLeft: number | null;
}): ReactElement {
  if (termEnd === null || daysLeft === null) {
    return <span className="muted">بلا مدة</span>;
  }
  return (
    <span className="stack" style={{ gap: 2 }}>
      <bdi dir="ltr" className="mono">
        {isoDate(termEnd)}
      </bdi>
      {daysLeft < 0 ? (
        <span className="badge" data-tone="critical" data-role="term-lapsed">
          {termPhrase(daysLeft)}
        </span>
      ) : (
        <span className={daysLeft <= 30 ? 'badge' : 'faint'} data-role="term-left">
          {termPhrase(daysLeft)}
        </span>
      )}
    </span>
  );
}

function CapacityCell({ used, included }: { used: number; included: number | null }): ReactElement {
  if (included === null) {
    return (
      <span>
        <bdi dir="ltr" className="mono">
          {count(used)}
        </bdi>{' '}
        <span className="faint">بلا حد</span>
      </span>
    );
  }
  const share = Math.min(1, included === 0 ? 1 : used / included);
  return (
    <span className="stack" style={{ gap: 4 }}>
      <span>
        <bdi dir="ltr" className="mono">
          {count(used)}
        </bdi>{' '}
        من{' '}
        <bdi dir="ltr" className="mono">
          {count(included)}
        </bdi>
      </span>
      <span className="meter" aria-hidden="true">
        <span
          className="meter-fill"
          style={{ width: `${Math.round(share * 100)}%` }}
          data-full={share >= 0.8 ? 'yes' : 'no'}
        />
      </span>
    </span>
  );
}

export function OperatorTenants({ rows }: { rows: TenantRowView[] }): ReactElement {
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="المشتركون"
        subtitle="كل مشترك بباقته، وتاريخ انتهائها، وما تبقى له من عمليات ورصيد."
      />

      <Panel title="المشتركون النشطون" aside={`${rows.length}`} role="tenants">
        {rows.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لا مشتركين بعد.</EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>المشترك</th>
                  <th>الباقة</th>
                  <th>تنتهي</th>
                  <th>العمليات</th>
                  <th>الرصيد المتاح (ريال)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.tenantId} data-role="tenant-row">
                    <td>
                      <a href={`/operator/subscribers/${row.tenantId}`}>{row.legalName}</a>
                      <div className="faint">
                        <bdi dir="ltr" className="mono">
                          {row.slug}
                        </bdi>
                        {row.hasSandbox ? ' · لديه بيئة اختبار' : ''}
                      </div>
                    </td>
                    <td>{row.packageNameAr ?? <span className="muted">بلا باقة</span>}</td>
                    <td>
                      <TermCell termEnd={row.termEnd} daysLeft={row.daysLeft} />
                    </td>
                    <td>
                      <CapacityCell
                        used={row.transactionsUsed}
                        included={row.includedTransactions}
                      />
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {riyals(row.availableHalalas)}
                      </bdi>
                      {row.lowBalance ? (
                        <>
                          {' '}
                          <span className="badge" data-tone="critical" data-role="low-balance">
                            منخفض
                          </span>
                        </>
                      ) : null}
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

export interface TenantDetailView extends TenantRowView {
  status: string | null;
  termStart: Date | null;
  createdAt: Date;
  balanceHalalas: number;
  heldHalalas: number;
  platformFeeHalalas: number;
  usage: {
    productCode: string;
    productNameAr: string;
    runs: number;
    packageRuns: number;
    billedHalalas: number;
    costHalalas: number;
  }[];
  topUps: {
    reference: string;
    amountHalalas: number;
    status: 'REQUESTED' | 'CONFIRMED' | 'REJECTED';
    requestedAt: Date;
    settledAt: Date | null;
  }[];
}

const TOPUP_STATUS: Record<TenantDetailView['topUps'][number]['status'], string> = {
  REQUESTED: 'بانتظار التأكيد',
  CONFIRMED: 'أُضيف للرصيد',
  REJECTED: 'مرفوضة',
};

export function OperatorTenantDetail({ view }: { view: TenantDetailView }): ReactElement {
  const left =
    view.includedTransactions === null
      ? null
      : Math.max(0, view.includedTransactions - view.transactionsUsed);

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title={view.legalName}
        subtitle={`مشترك منذ ${isoDate(view.createdAt)}.`}
        action={
          <a className="btn btn-secondary" href="/operator/pricing">
            تعديل الباقة
          </a>
        }
      />

      <section className="grid" data-role="tenant-figures">
        <article className="stat">
          <span className="stat-label">الباقة</span>
          <strong className="stat-value" style={{ fontSize: '18px' }}>
            {view.packageNameAr ?? 'بلا باقة'}
          </strong>
          {view.termStart ? (
            <span className="stat-hint">
              من{' '}
              <bdi dir="ltr" className="mono">
                {isoDate(view.termStart)}
              </bdi>
            </span>
          ) : null}
        </article>
        <article
          className="stat"
          {...(view.daysLeft !== null && view.daysLeft < 0 ? { 'data-tone': 'critical' } : {})}
        >
          <span className="stat-label">تنتهي</span>
          <strong className="stat-value" style={{ fontSize: '18px' }}>
            <bdi dir="ltr" className="mono">
              {view.termEnd ? isoDate(view.termEnd) : 'بلا مدة'}
            </bdi>
          </strong>
          {view.daysLeft !== null ? (
            <span className="stat-hint">{termPhrase(view.daysLeft)}</span>
          ) : null}
        </article>
        <article className="stat">
          <span className="stat-label">العمليات المتبقية</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {left === null ? 'بلا حد' : count(left)}
            </bdi>
          </strong>
          <span className="stat-hint">
            استُخدم{' '}
            <bdi dir="ltr" className="mono">
              {count(view.transactionsUsed)}
            </bdi>
            {view.includedTransactions === null ? null : (
              <>
                {' '}
                من{' '}
                <bdi dir="ltr" className="mono">
                  {count(view.includedTransactions)}
                </bdi>
              </>
            )}
          </span>
        </article>
        <article className="stat" {...(view.lowBalance ? { 'data-tone': 'critical' } : {})}>
          <span className="stat-label">الرصيد المتاح</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {riyals(view.availableHalalas)}
            </bdi>
          </strong>
          <span className="stat-hint">
            محجوز لعمليات جارية:{' '}
            <bdi dir="ltr" className="mono">
              {riyals(view.heldHalalas)}
            </bdi>
          </span>
        </article>
      </section>

      <Panel title="الاستهلاك في هذه المدة" aside="حسب منتج التحقق" role="tenant-usage">
        {view.usage.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لم يشغّل هذا المشترك أي عملية تحقق في هذه المدة.</EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th>العمليات</th>
                  <th>منها من الباقة</th>
                  <th>الإيراد (ريال)</th>
                  <th>التكلفة (ريال)</th>
                </tr>
              </thead>
              <tbody>
                {view.usage.map((line) => (
                  <tr key={line.productCode}>
                    <td>{line.productNameAr}</td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {count(line.runs)}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {count(line.packageRuns)}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {riyals(line.billedHalalas)}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {riyals(line.costHalalas)}
                      </bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="طلبات الشحن" aside="آخر 20" role="tenant-topups">
        {view.topUps.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لم يطلب هذا المشترك شحن رصيد بعد.</EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>المرجع</th>
                  <th>المبلغ (ريال، بلا ضريبة)</th>
                  <th>الحالة</th>
                  <th>تاريخ الطلب</th>
                </tr>
              </thead>
              <tbody>
                {view.topUps.map((line) => (
                  <tr key={line.reference}>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {line.reference}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {riyals(line.amountHalalas)}
                      </bdi>
                    </td>
                    <td>
                      {line.status === 'REQUESTED' ? (
                        <a href="/operator/subscribers/topups">{TOPUP_STATUS[line.status]}</a>
                      ) : (
                        TOPUP_STATUS[line.status]
                      )}
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {isoDate(line.requestedAt)}
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
