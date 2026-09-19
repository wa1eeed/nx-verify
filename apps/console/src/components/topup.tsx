import type { ReactElement } from 'react';
import { Button } from './ui/button';
import { Card, CardEmpty, CardNote, CardTitle } from './ui/card';
import { Disclosure } from './ui/disclosure';
import { Field } from './ui/field';
import { Input } from './ui/input';
import { Ltr } from './ui/ltr';
import { StatHint, StatLabel, StatValue } from './ui/stat';
import { SubmitButton } from './ui/submit-button';
import { Table, Th } from './ui/table';
import { Tag, type TagTone } from './ui/tag';
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

/** Waiting is neutral, arrived is the sage of something done, refused is the red of a failure. */
const STATUS_TONES: Record<TopUpRowView['status'], TagTone> = {
  REQUESTED: 'neutral',
  CONFIRMED: 'accent-2',
  REJECTED: 'critical',
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
    <Card role="topup" labelledBy="topup-title">
      <CardTitle as="h2" size="section" id="topup-title">
        شحن الرصيد
      </CardTitle>
      <CardNote>اختر المبلغ، ثم تُراجع التفاصيل وبيانات التحويل قبل إرسال الطلب.</CardNote>

      {issued ? (
        <Card as="div" variant="plain" tone="accent-2" role="issued-topup">
          <StatLabel>الرقم المرجعي للحوالة</StatLabel>
          <StatValue role="topup-reference">
            <Ltr>{issued.reference}</Ltr>
          </StatValue>
          <span>
            المبلغ المطلوب تحويله <Ltr>{riyals(issued.totalWithVatHalalas)}</Ltr> ر.س.
          </span>
          {bankKnown ? (
            <div className="admin-offer" data-role="bank-details">
              <span className="faint">{bank.accountName}</span>
              <span className="faint">{bank.bankName}</span>
              {/* In fours: a run of twenty four characters is where the eye loses its place
                  copying an account number into a banking app. */}
              <Ltr>
                <span data-role="bank-iban">{ibanGroups(bank.iban ?? '')}</span>
              </Ltr>
            </div>
          ) : (
            <StatHint role="bank-unknown">
              بيانات الحساب البنكي غير مضبوطة في هذا النشر. تواصل معنا وسنرسلها.
            </StatHint>
          )}
        </Card>
      ) : null}

      {/*
        A GET to the checkout, so «how much» is answered here and everything that follows from
        it is answered on the screen that commits. Nothing is ordered by pressing this.
      */}
      <form action="/billing/checkout" method="get" className="row amount-row">
        <Field id="topup-amount" label="المبلغ بالريال">
          {(control) => (
            <Input
              {...control}
              name="amount"
              type="number"
              min="100"
              step="1"
              defaultValue="1000"
              required
              ltr
            />
          )}
        </Field>
        <Button type="submit" data-role="request-topup">
          تابع الشراء
        </Button>
      </form>

      {requests.length > 0 ? (
        <Table label="طلبات شحن الرصيد">
          <thead>
            <tr>
              <Th>المرجع</Th>
              <Th>المبلغ</Th>
              <Th>الحالة</Th>
              <Th>الفاتورة الضريبية</Th>
              <Th>التاريخ</Th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id} data-role="topup-request" data-status={request.status}>
                <td>
                  <Ltr>{request.reference}</Ltr>
                </td>
                <td>
                  <Ltr>{riyals(request.totalWithVatHalalas)}</Ltr> ر.س
                </td>
                <td>
                  <Tag tone={STATUS_TONES[request.status]} role="topup-status">
                    {request.bundleLabel && request.status === 'CONFIRMED'
                      ? `أُضيفت ${request.bundleLabel}`
                      : STATUS_LABELS[request.status]}
                  </Tag>
                  {request.bundleLabel && request.status !== 'CONFIRMED' ? (
                    <span className="admin-offer-terms" data-role="topup-bundle">
                      {' · '}
                      {request.bundleLabel}
                    </span>
                  ) : null}
                  {/*
                    Why it was not accepted, in the words staff wrote when they closed it. The
                    reason was read from the database, carried into this row and then dropped,
                    so a subscriber read «لم يُقبل» with nothing to act on and no way to tell a
                    transfer that never arrived from one we refused.
                  */}
                  {request.status === 'REJECTED' && request.note !== null ? (
                    <div className="faint" data-role="topup-reason">
                      {request.note}
                    </div>
                  ) : null}
                </td>
                <td>
                  {request.vatInvoiceId ? (
                    <Ltr>{request.vatInvoiceId}</Ltr>
                  ) : (
                    <span className="faint">تصدر عند الإضافة</span>
                  )}
                </td>
                <td>
                  <Ltr>{isoDate(request.requestedAt)}</Ltr>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </Card>
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
      <Card variant="flush" label="الحوالات">
        <CardEmpty role="no-pending-topups">لا حوالات بانتظار التأكيد.</CardEmpty>
      </Card>
    );
  }

  return (
    <Card variant="flush" role="pending-topups" label="حوالات بانتظار التأكيد">
      <div className="admin-table">
        <Table label="حوالات بانتظار التأكيد">
          <thead>
            <tr>
              <Th>المشترك</Th>
              <Th>المرجع</Th>
              <Th>بلا ضريبة</Th>
              <Th>شامل الضريبة</Th>
              <Th>التأكيد</Th>
            </tr>
          </thead>
          <tbody>
            {pending.map((request) => (
              <tr key={request.id} data-role="pending-topup">
                <td>
                  {request.tenantName}
                  {request.bundleLabel ? (
                    <span className="admin-offer-terms" data-role="topup-bundle">
                      {' · '}
                      {request.bundleLabel}
                    </span>
                  ) : null}
                </td>
                <td>
                  <Ltr>{request.reference}</Ltr>
                </td>
                <td>
                  <Ltr>{riyals(request.amountHalalas)}</Ltr> ر.س
                </td>
                <td>
                  <Ltr>{riyals(request.totalWithVatHalalas)}</Ltr> ر.س
                </td>
                <td>
                  <form action={confirmAction} className="row">
                    <input type="hidden" name="request_id" value={request.id} />
                    <input type="hidden" name="tenant_id" value={request.tenantId} />
                    <Input
                      name="vat_invoice_id"
                      placeholder="رقم الفاتورة الضريبية"
                      required
                      aria-label={`رقم الفاتورة الضريبية لحوالة ${request.reference}`}
                      ltr
                    />
                    <SubmitButton
                      variant="secondary"
                      data-role="confirm-topup"
                      pendingLabel="جارٍ الإضافة"
                    >
                      أضف للرصيد
                    </SubmitButton>
                  </form>
                  {/*
                    Rejecting closes the request for good: nothing reopens it and nothing in
                    this screen can undo it. Two steps, and the consequence above the button
                    that causes it, the same pattern the API key revoke uses (ADR-167).
                  */}
                  <Disclosure
                    role="reject-topup"
                    summary="لم تصل الحوالة"
                    consequence="يُغلق الطلب ولا يُضاف للرصيد شيء، ولا يعود إلى هذه القائمة. إن وصلت الحوالة بعد ذلك فالمشترك يطلب شحناً جديداً."
                  >
                    <form action={rejectAction} className="inline">
                      <input type="hidden" name="request_id" value={request.id} />
                      <input type="hidden" name="tenant_id" value={request.tenantId} />
                      <SubmitButton
                        variant="ghost"
                        data-role="reject-confirm"
                        pendingLabel="جارٍ الإغلاق"
                      >
                        أكّد أنها لم تصل
                      </SubmitButton>
                    </form>
                  </Disclosure>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Card>
  );
}
