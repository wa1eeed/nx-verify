import type { ReactElement } from 'react';

/**
 * Portfolios.
 *
 * The columns are the policy, because that is what a portfolio is. Showing the retention
 * override and the monitoring budget on the list is what stops a portfolio from quietly
 * becoming a folder: the operator sees, at a glance, what belonging to it costs and what
 * it enforces.
 */

export interface PortfolioRowView {
  portfolioId: string;
  code: string;
  nameAr: string;
  entities: number;
  withExpired: number;
  openCases: number;
  monitorByDefault: boolean;
  monitorBudget: number | null;
  decisionRuleset: string | null;
}

export function Portfolios({ rows }: { rows: PortfolioRowView[] }): ReactElement {
  return (
    <div className="stack">
      <h1>المحافظ</h1>

      <p className="muted">
        السياسة تنتمي للمحفظة لا للنظام. مدد الصلاحية وقواعد القرار والمراقبة تُضبط هنا، وعند تعارض
        محفظتين تفوز المدة الأقصر.
      </p>

      <section className="card">
        <table>
          <thead>
            <tr>
              <th>المحفظة</th>
              <th>الكيانات</th>
              <th>منتهية الصلاحية</th>
              <th>حالات مفتوحة</th>
              <th>المراقبة</th>
              <th>قواعد القرار</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.portfolioId}>
                <td>{row.nameAr}</td>
                <td>
                  <bdi dir="ltr" className="mono">
                    {row.entities}
                  </bdi>
                </td>
                <td>
                  <bdi dir="ltr" className="mono">
                    {row.withExpired}
                  </bdi>
                </td>
                <td>
                  <bdi dir="ltr" className="mono">
                    {row.openCases}
                  </bdi>
                </td>
                <td className="muted">
                  {row.monitorByDefault ? (
                    <span data-role="monitoring">
                      مفعّلة بسقف{' '}
                      <bdi dir="ltr" className="mono">
                        {((row.monitorBudget ?? 0) / 100).toFixed(2)}
                      </bdi>{' '}
                      ريال
                    </span>
                  ) : (
                    'غير مفعّلة'
                  )}
                </td>
                <td className="muted">{row.decisionRuleset ? 'خاصة بالمحفظة' : 'قواعد المنتج'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="muted">لا توجد محافظ بعد.</p> : null}
      </section>

      <div className="row">
        <button type="submit" className="btn-primary">
          محفظة جديدة
        </button>
      </div>
    </div>
  );
}
