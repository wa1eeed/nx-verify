import type { ReactElement } from 'react';
import { count, ibanGroups, isoDate, riyals } from './format';

/**
 * The transfers a workspace has asked for, and a way to ask for another.
 *
 * The amount box is a link into the checkout rather than an order of its own (ADR-158). What
 * it collects is «how much», which is a question this screen can ask; the total, the tax line
 * if any is due, the method and the account belong on the screen where somebody commits, and
 * they used to appear only after the commitment.
 *
 * Every amount shown is the amount to actually send, under the tax rule of that request's own
 * date. An amount shown without the tax due beside bank details produces transfers that are
 * short by the rate, every time.
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
  /** «حزمة 500 عملية» when the transfer buys a bundle; null for credit in riyals. */
  bundleLabel?: string | null;
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

/** «حزمة 500 عملية», from a bundle's code, or null for credit in riyals. */
export function bundleLabelOf(bundleCode: string | null): string | null {
  if (bundleCode === null) {
    return null;
  }
  const operations = Number(bundleCode.replace(/^BUNDLE_/, ''));
  return Number.isInteger(operations) && operations > 0
    ? `حزمة ${count(operations)} عملية`
    : 'حزمة رصيد';
}

export function TopUpPanel({
  requests,
  bank,
  issued,
}: {
  requests: TopUpRowView[];
  bank: BankDetails;
  /** Present for one render, straight after asking. */
  issued?: TopUpRowView | null;
}): ReactElement {
  const bankKnown = bank.iban !== null && bank.iban !== '';

  return (
    <section className="card stack" data-role="topup" style={{ gap: 'var(--s-4)' }}>
      <div>
        <h2 style={{ margin: 0 }}>شحن الرصيد</h2>
        <p className="faint" style={{ margin: 0 }}>
          اختر المبلغ، ثم تُراجع التفاصيل وبيانات التحويل قبل إرسال الطلب.
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
            ر.س.
          </span>
          {bankKnown ? (
            <div className="stack" style={{ gap: 0 }} data-role="bank-details">
              <span className="faint">{bank.accountName}</span>
              <span className="faint">{bank.bankName}</span>
              {/* In fours: a run of twenty four characters is where the eye loses its place
                  copying an account number into a banking app. */}
              <bdi dir="ltr" className="mono" data-role="bank-iban">
                {ibanGroups(bank.iban ?? '')}
              </bdi>
            </div>
          ) : (
            <span className="stat-hint" data-role="bank-unknown">
              بيانات الحساب البنكي غير مضبوطة في هذا النشر. تواصل معنا وسنرسلها.
            </span>
          )}
        </div>
      ) : null}

      {/*
        A GET to the checkout, so «how much» is answered here and everything that follows from
        it is answered on the screen that commits. Nothing is ordered by pressing this.
      */}
      <form
        action="/billing/checkout"
        method="get"
        className="row"
        style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}
      >
        <label className="stack" style={{ gap: 'var(--s-1)' }}>
          <span className="stat-label">المبلغ بالريال</span>
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
        <button type="submit" className="btn btn-secondary" data-role="request-topup">
          تابع الشراء
        </button>
      </form>

      {requests.length > 0 ? (
        <div className="table-scroll">
          <table data-role="topup-list">
            <thead>
              <tr>
                <th>المرجع</th>
                <th>المبلغ</th>
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
                  <td>
                    {request.bundleLabel && request.status === 'CONFIRMED'
                      ? `أُضيفت ${request.bundleLabel}`
                      : STATUS_LABELS[request.status]}
                    {request.bundleLabel && request.status !== 'CONFIRMED' ? (
                      <span className="muted" data-role="topup-bundle">
                        {' '}
                        · {request.bundleLabel}
                      </span>
                    ) : null}
                  </td>
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
                      {isoDate(request.requestedAt)}
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
              <td>
                {request.tenantName}
                {request.bundleLabel ? (
                  <span className="muted" data-role="topup-bundle">
                    {' '}
                    · {request.bundleLabel}
                  </span>
                ) : null}
              </td>
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
                  <button type="submit" className="btn btn-secondary" data-role="confirm-topup">
                    أضف للرصيد
                  </button>
                </form>
                <form action={rejectAction}>
                  <input type="hidden" name="request_id" value={request.id} />
                  <input type="hidden" name="tenant_id" value={request.tenantId} />
                  <button type="submit" className="btn btn-secondary" data-role="reject-topup">
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
