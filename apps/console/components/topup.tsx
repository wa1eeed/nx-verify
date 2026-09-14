import type { ReactElement } from 'react';

/**
 * Asking to put money in.
 *
 * A bank transfer, not a card. The screen's whole job is to make the transfer arrive with
 * something we can match it by, so the reference is the largest thing on it and the
 * amount shown is the one to actually send, VAT included. Showing the amount without VAT
 * next to bank details produces transfers that are fifteen percent short, every time.
 */

export interface TopUpRowView {
  id: string;
  reference: string;
  amountHalalas: number;
  totalWithVatHalalas: number;
  status: 'REQUESTED' | 'CONFIRMED' | 'REJECTED';
  requestedAt: Date;
  vatInvoiceId: string | null;
  note: string | null;
}

export interface BankDetails {
  accountName: string | null;
  bankName: string | null;
  iban: string | null;
}

const STATUS_LABELS: Record<TopUpRowView['status'], string> = {
  REQUESTED: 'بانتظار وصول الحوالة',
  CONFIRMED: 'أُضيف للرصيد',
  REJECTED: 'لم يُقبل',
};

function riyals(halalas: number): string {
  return (halalas / 100).toFixed(2);
}

export function TopUpPanel({
  requests,
  bank,
  issued,
  requestAction,
}: {
  requests: TopUpRowView[];
  bank: BankDetails;
  /** Present for one render, straight after asking. */
  issued?: TopUpRowView | null;
  requestAction: string | ((formData: FormData) => void | Promise<void>);
}): ReactElement {
  const bankKnown = bank.iban !== null && bank.iban !== '';

  return (
    <section className="card stack" data-role="topup" style={{ gap: 'var(--s-4)' }}>
      <div>
        <h2 style={{ margin: 0 }}>شحن الرصيد</h2>
        <p className="faint" style={{ margin: 0 }}>
          اطلب المبلغ، ثم حوّله وضع الرقم المرجعي في بيان الحوالة. يُضاف للرصيد بعد وصوله.
        </p>
      </div>

      {issued ? (
        <div
          className="stack"
          data-role="issued-topup"
          style={{
            gap: 'var(--s-2)',
            border: '1px solid var(--fresh-line)',
            background: 'var(--fresh-bg)',
            borderRadius: 'var(--radius)',
            padding: 'var(--s-3)',
          }}
        >
          <span className="stat-label">الرقم المرجعي للحوالة</span>
          <strong
            className="mono"
            dir="ltr"
            style={{ fontSize: '24px' }}
            data-role="topup-reference"
          >
            {issued.reference}
          </strong>
          <span>
            المبلغ المطلوب تحويله{' '}
            <bdi dir="ltr" className="mono">
              {riyals(issued.totalWithVatHalalas)}
            </bdi>{' '}
            ريال، شامل ضريبة القيمة المضافة.
          </span>
          {bankKnown ? (
            <div className="stack" style={{ gap: 0 }} data-role="bank-details">
              <span className="faint">{bank.accountName}</span>
              <span className="faint">{bank.bankName}</span>
              <bdi dir="ltr" className="mono">
                {bank.iban}
              </bdi>
            </div>
          ) : (
            <span className="stat-hint" data-role="bank-unknown">
              بيانات الحساب البنكي غير مضبوطة في هذا النشر. تواصل معنا وسنرسلها.
            </span>
          )}
        </div>
      ) : null}

      <form action={requestAction} className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
        <label className="stack" style={{ gap: 'var(--s-1)' }}>
          <span className="stat-label">المبلغ بالريال، بلا ضريبة</span>
          <input
            name="amount"
            type="number"
            min="100"
            step="1"
            defaultValue="1000"
            dir="ltr"
            className="mono"
            style={{ width: 'auto' }}
            required
          />
        </label>
        <button type="submit" className="btn-secondary" data-role="request-topup">
          اطلب الشحن
        </button>
      </form>

      {requests.length > 0 ? (
        <div className="table-scroll">
          <table data-role="topup-list">
            <thead>
              <tr>
                <th>المرجع</th>
                <th>المبلغ شامل الضريبة</th>
                <th>الحالة</th>
                <th>الفاتورة الضريبية</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id} data-status={request.status}>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {request.reference}
                    </bdi>
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {riyals(request.totalWithVatHalalas)}
                    </bdi>
                  </td>
                  <td>{STATUS_LABELS[request.status]}</td>
                  <td>
                    {request.vatInvoiceId ? (
                      <bdi dir="ltr" className="mono">
                        {request.vatInvoiceId}
                      </bdi>
                    ) : (
                      <span className="faint">تصدر عند الإضافة</span>
                    )}
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {request.requestedAt.toISOString().slice(0, 10)}
                    </bdi>
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

export interface PendingTopUpView extends TopUpRowView {
  tenantId: string;
  tenantName: string;
}

/**
 * What staff reconcile against the bank statement.
 *
 * The tax invoice number is required to confirm, because VAT falls due when credit is
 * bought and a confirmed top up without one is an accounting problem found at the year
 * end. The database refuses the row in that state too.
 */
export function PendingTopUps({
  pending,
  confirmAction,
  rejectAction,
}: {
  pending: PendingTopUpView[];
  confirmAction: string | ((formData: FormData) => void | Promise<void>);
  rejectAction: string | ((formData: FormData) => void | Promise<void>);
}): ReactElement {
  if (pending.length === 0) {
    return (
      <p className="empty" data-role="no-pending-topups">
        لا حوالات بانتظار التأكيد.
      </p>
    );
  }

  return (
    <div className="table-scroll">
      <table data-role="pending-topups">
        <thead>
          <tr>
            <th>المشترك</th>
            <th>المرجع</th>
            <th>بلا ضريبة</th>
            <th>شامل الضريبة</th>
            <th>التأكيد</th>
          </tr>
        </thead>
        <tbody>
          {pending.map((request) => (
            <tr key={request.id}>
              <td>{request.tenantName}</td>
              <td>
                <bdi dir="ltr" className="mono">
                  {request.reference}
                </bdi>
              </td>
              <td>
                <bdi dir="ltr" className="mono">
                  {riyals(request.amountHalalas)}
                </bdi>
              </td>
              <td>
                <bdi dir="ltr" className="mono">
                  {riyals(request.totalWithVatHalalas)}
                </bdi>
              </td>
              <td>
                <form action={confirmAction} className="row" style={{ gap: 'var(--s-2)' }}>
                  <input type="hidden" name="request_id" value={request.id} />
                  <input type="hidden" name="tenant_id" value={request.tenantId} />
                  <input
                    name="vat_invoice_id"
                    placeholder="رقم الفاتورة الضريبية"
                    dir="ltr"
                    className="mono"
                    required
                    style={{ width: 'auto' }}
                  />
                  <button type="submit" className="btn-secondary" data-role="confirm-topup">
                    أضف للرصيد
                  </button>
                </form>
                <form action={rejectAction}>
                  <input type="hidden" name="request_id" value={request.id} />
                  <input type="hidden" name="tenant_id" value={request.tenantId} />
                  <button type="submit" className="btn-secondary" data-role="reject-topup">
                    لم تصل
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
