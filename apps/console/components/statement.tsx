import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';

/**
 * The consumption statement.
 *
 * Deliberately not called an invoice, anywhere on this screen or in the module behind it.
 * VAT falls due when credit is bought and not when it is spent, so a top up produces a tax
 * invoice and everything after it is a statement. Calling this an invoice is not a wording
 * problem, it is a tax problem.
 */

export interface StatementLineView {
  month: string;
  productNameAr: string;
  runs: number;
  amountHalalas: number;
}

export interface TopUpView {
  at: Date;
  amountHalalas: number;
  vatInvoiceId: string | null;
}

export interface StatementView {
  lines: StatementLineView[];
  topUps: TopUpView[];
  spentThisTermHalalas: number;
  extras: {
    seats: number;
    chargeableSeats: number;
    seatChargeHalalas: number;
    portfolios: number;
    chargeablePortfolios: number;
    portfolioChargeHalalas: number;
    setupFeeHalalas: number;
    platformFeeHalalas: number;
    totalHalalas: number;
  } | null;
}

function riyals(halalas: number): string {
  return (halalas / 100).toFixed(2);
}

export function Statement({ view }: { view: StatementView }): ReactElement {
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="كشف الاستهلاك"
        subtitle="الأرقام بلا ضريبة. الفاتورة الضريبية تصدر عند شحن الرصيد، وما بعدها كشف لا فاتورة."
      />

      <Panel title="المستهلك في هذه المدة" aside={`${riyals(view.spentThisTermHalalas)} ريال`}>
        {view.lines.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لا استهلاك بعد في هذه المدة.</EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>الشهر</th>
                  <th>الوحدة</th>
                  <th>العمليات</th>
                  <th>المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {view.lines.map((line) => (
                  <tr key={`${line.month}-${line.productNameAr}`} data-role="statement-line">
                    <td>
                      <bdi dir="ltr" className="mono">
                        {line.month}
                      </bdi>
                    </td>
                    <td>{line.productNameAr}</td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {line.runs}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {riyals(line.amountHalalas)}
                      </bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {view.extras && view.extras.totalHalalas > 0 ? (
        <Panel title="ما يُفوتر خارج الاستهلاك" role="extras">
          <ul className="panel-body stack" style={{ gap: 'var(--s-2)', margin: 0 }}>
            {view.extras.chargeableSeats > 0 ? (
              <li>
                مقاعد إضافية: {view.extras.chargeableSeats} من {view.extras.seats} ·{' '}
                <bdi dir="ltr" className="mono">
                  {riyals(view.extras.seatChargeHalalas)}
                </bdi>
              </li>
            ) : null}
            {view.extras.chargeablePortfolios > 0 ? (
              <li>
                محافظ إضافية: {view.extras.chargeablePortfolios} من {view.extras.portfolios} ·{' '}
                <bdi dir="ltr" className="mono">
                  {riyals(view.extras.portfolioChargeHalalas)}
                </bdi>
              </li>
            ) : null}
            {view.extras.setupFeeHalalas > 0 ? (
              <li>
                رسم التأسيس:{' '}
                <bdi dir="ltr" className="mono">
                  {riyals(view.extras.setupFeeHalalas)}
                </bdi>
              </li>
            ) : null}
            {view.extras.platformFeeHalalas > 0 ? (
              <li>
                رسم المنصة والدعم:{' '}
                <bdi dir="ltr" className="mono">
                  {riyals(view.extras.platformFeeHalalas)}
                </bdi>
              </li>
            ) : null}
          </ul>
        </Panel>
      ) : null}

      <Panel title="شحنات الرصيد" aside="كل شحنة لها فاتورة ضريبية" role="topups">
        {view.topUps.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لا شحنات مسجّلة بعد.</EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المبلغ</th>
                  <th>الفاتورة الضريبية</th>
                </tr>
              </thead>
              <tbody>
                {view.topUps.map((topUp) => (
                  <tr key={`${topUp.at.toISOString()}-${topUp.vatInvoiceId ?? ''}`} data-role="topup">
                    <td>
                      <bdi dir="ltr" className="mono">
                        {topUp.at.toISOString().slice(0, 10)}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {riyals(topUp.amountHalalas)}
                      </bdi>
                    </td>
                    <td>
                      {topUp.vatInvoiceId ? (
                        <bdi dir="ltr" className="mono">
                          {topUp.vatInvoiceId}
                        </bdi>
                      ) : (
                        <span className="muted">بلا مرجع</span>
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
