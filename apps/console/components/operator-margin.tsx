import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';

/**
 * What each customer earns us, by service.
 *
 * An operator screen, behind an operator token and an operator connection, and the only
 * screen in this console that crosses subscribers. The numbers come from aggregated
 * counters rather than from runs, so the query behind it cannot reach an entity or a
 * decision even by accident.
 *
 * Two figures here are easy to get wrong and are spelled out rather than computed away.
 * Work the package covered earns nothing this month and costs us everything, so it is
 * shown as its own column rather than folded into revenue. And a margin on no revenue is
 * undefined rather than zero, because printing zero invites somebody to average it.
 */

export interface MarginRowView {
  tenantName: string;
  productNameAr: string;
  periodStart: Date;
  runs: number;
  packageRuns: number;
  billedHalalas: number;
  providerCostHalalas: number;
  grossHalalas: number;
  marginPct: number | null;
}

function riyals(halalas: number): string {
  return (halalas / 100).toFixed(2);
}

export function OperatorMargin({ rows }: { rows: MarginRowView[] }): ReactElement {
  const billed = rows.reduce((total, row) => total + row.billedHalalas, 0);
  const cost = rows.reduce((total, row) => total + row.providerCostHalalas, 0);
  const covered = rows.reduce((total, row) => total + row.packageRuns, 0);

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="الهامش"
        subtitle="ما حصّلناه وما دفعناه للمزودين، لكل مشترك ولكل خدمة. من عدّادات مجمّعة لا من التشغيلات."
      />

      <section className="grid" data-role="margin-tiles">
        <article className="stat">
          <span className="stat-label">المحصّل</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {riyals(billed)}
            </bdi>
          </strong>
          <span className="stat-hint">بلا ضريبة</span>
        </article>
        <article className="stat">
          <span className="stat-label">تكلفة المزودين</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {riyals(cost)}
            </bdi>
          </strong>
        </article>
        <article className="stat">
          <span className="stat-label">الهامش</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {billed === 0 ? 'لا إيراد' : `${Math.round(((billed - cost) / billed) * 100)}%`}
            </bdi>
          </strong>
          <span className="stat-hint">
            <bdi dir="ltr" className="mono">
              {riyals(billed - cost)}
            </bdi>{' '}
            ريال
          </span>
        </article>
        <article className="stat">
          <span className="stat-label">غطّتها الباقات</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {covered}
            </bdi>
          </strong>
          <span className="stat-hint">عمليات لا تُحصَّل هذا الشهر</span>
        </article>
      </section>

      <Panel title="التفصيل" aside={`${rows.length} سطراً`}>
        {rows.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لا استهلاك مسجّل في هذه الفترة.</EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>الشهر</th>
                  <th>المشترك</th>
                  <th>الخدمة</th>
                  <th>العمليات</th>
                  <th>بالباقة</th>
                  <th>المحصّل</th>
                  <th>التكلفة</th>
                  <th>الهامش</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.periodStart.toISOString()}-${row.tenantName}-${row.productNameAr}`}
                    data-role="margin-row"
                  >
                    <td>
                      <bdi dir="ltr" className="mono">
                        {row.periodStart.toISOString().slice(0, 7)}
                      </bdi>
                    </td>
                    <td>{row.tenantName}</td>
                    <td>{row.productNameAr}</td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {row.runs}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {row.packageRuns}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {riyals(row.billedHalalas)}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {riyals(row.providerCostHalalas)}
                      </bdi>
                    </td>
                    <td data-role="margin-cell">
                      {row.marginPct === null ? (
                        // Undefined, not zero. A report that prints zero here invites
                        // somebody to average it.
                        <span className="muted">لا إيراد</span>
                      ) : (
                        <bdi dir="ltr" className="mono">
                          {row.marginPct}%
                        </bdi>
                      )}
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
