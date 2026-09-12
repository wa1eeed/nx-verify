import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';

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
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="المجموعات"
        subtitle="جمّع عملاءك حسب الغرض، واضبط لكل مجموعة مدد صلاحيتها وقواعد قرارها ومراقبتها."
        action={
          <button type="submit" className="btn-primary">
            محفظة جديدة
          </button>
        }
      />

      <Panel
        title="المحافظ القائمة"
        aside={`${rows.length} محفظة`}
        note="الكيان قد ينتمي لأكثر من مجموعة. عند تعارض مجموعتين تفوز المدة الأقصر."
      >
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>المحفظة</th>
              <th>السجلات</th>
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
        </div>
        {rows.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لا محافظ بعد. المحفظة هي المكان الذي تُضبط فيه السياسة.</EmptyState>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
