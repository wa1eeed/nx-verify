import type { ReactElement } from 'react';
import Link from 'next/link';
import { Card } from './ui/card';
import { SubmitButton } from './ui/submit-button';

/**
 * Buying credit: what you are buying, what it costs, how you pay, and where you send it
 * (ADR-158).
 *
 * The screen it replaces was one number and a button. The bank details appeared only after
 * the request had been made, which is the wrong order: somebody deciding whether to buy is
 * deciding on the total and on whether a transfer is a payment method they can use, and both
 * were hidden behind the commitment.
 *
 * So the order here is the order of the decision. What is being bought, then the total with
 * the tax line if any tax is due, then how to pay, then the account, and only then the
 * button. Nothing on this screen is a surprise that arrives after pressing it.
 *
 * The card option is shown and disabled rather than hidden. A buyer looking for it should
 * find out that it is coming rather than conclude the platform does not take cards, and the
 * gateway that arrives later has a place already built for it.
 */

export interface CheckoutLine {
  /** «حزمة 500 عملية» or «رصيد بالريال». */
  titleAr: string;
  detailAr: string | null;
  netHalalas: number;
  vatHalalas: number;
  grossHalalas: number;
  /** True when the platform is registered, so the tax line means something. */
  taxed: boolean;
}

export interface CheckoutBank {
  accountName: string | null;
  bankName: string | null;
  iban: string | null;
  note: string | null;
}

function riyals(halalas: number): string {
  return (halalas / 100).toFixed(2);
}

/** The IBAN in fours, which is how it is read off a screen and typed into a bank app. */
function ibanGroups(iban: string): string {
  return (iban.match(/.{1,4}/g) ?? [iban]).join(' ');
}

export function Checkout({
  line,
  bank,
  bundleCode,
  amountHalalas,
  action,
  backHref = '/billing',
}: {
  line: CheckoutLine;
  bank: CheckoutBank;
  /** One of these two is set: a bundle by code, or credit for an amount. */
  bundleCode?: string | null;
  amountHalalas?: number | null;
  action: (formData: FormData) => void | Promise<void>;
  backHref?: string;
}): ReactElement {
  const bankKnown = bank.iban !== null && bank.iban !== '';

  return (
    <div className="stack checkout" data-role="checkout" style={{ gap: 'var(--s-4)' }}>
      <Card role="checkout-summary" labelledBy="checkout-what">
        <h2 className="card-title" id="checkout-what">
          ما ستشتريه
        </h2>
        <div className="stack" style={{ gap: 'var(--s-2)' }}>
          <div className="row checkout-line" style={{ gap: 'var(--s-3)' }}>
            <span className="stack" style={{ gap: 0, flex: 1 }}>
              <strong data-role="checkout-title">{line.titleAr}</strong>
              {line.detailAr === null ? null : <span className="faint">{line.detailAr}</span>}
            </span>
            <span className="mono" dir="ltr" data-role="checkout-net">
              {riyals(line.netHalalas)}
            </span>
          </div>

          {/*
            A tax line only when tax is actually due. A zero line from a seller who is not
            registered claims something untrue about the seller (ADR-157).
          */}
          {line.taxed ? (
            <div className="row checkout-line" style={{ gap: 'var(--s-3)' }}>
              <span className="faint" style={{ flex: 1 }}>
                ضريبة القيمة المضافة
              </span>
              <span className="mono" dir="ltr" data-role="checkout-vat">
                {riyals(line.vatHalalas)}
              </span>
            </div>
          ) : (
            <p className="stat-hint" style={{ margin: 0 }} data-role="checkout-untaxed">
              لا ضريبة قيمة مضافة على هذا المبلغ.
            </p>
          )}

          <div className="row checkout-total" style={{ gap: 'var(--s-3)' }}>
            <strong style={{ flex: 1 }}>المبلغ المطلوب تحويله</strong>
            <strong className="mono" dir="ltr" data-role="checkout-total">
              {riyals(line.grossHalalas)} ر.س
            </strong>
          </div>
        </div>
      </Card>

      <Card role="checkout-method" labelledBy="checkout-how">
        <h2 className="card-title" id="checkout-how">
          وسيلة الدفع
        </h2>
        <div className="stack" style={{ gap: 'var(--s-2)' }}>
          <label className="checkout-method-option" data-role="method-transfer" data-selected="true">
            <input type="radio" name="method" value="transfer" defaultChecked form="checkout-form" />
            <span className="stack" style={{ gap: 0 }}>
              <strong>تحويل بنكي</strong>
              <span className="faint">
                تحوّل المبلغ إلى حسابنا وتضع الرقم المرجعي في بيان الحوالة، ثم نؤكّده ويُضاف رصيدك.
              </span>
            </span>
          </label>

          <label className="checkout-method-option" data-role="method-card" data-disabled="true">
            <input type="radio" name="method" value="card" disabled />
            <span className="stack" style={{ gap: 0 }}>
              <strong>بطاقة مدى أو ائتمانية</strong>
              <span className="faint">قريباً. لم تُفعّل بوابة الدفع بعد.</span>
            </span>
          </label>
        </div>
      </Card>

      <Card role="checkout-bank" labelledBy="checkout-where">
        <h2 className="card-title" id="checkout-where">
          حسابنا البنكي
        </h2>
        {bankKnown ? (
          <div className="stack" data-role="bank-details" style={{ gap: 'var(--s-2)' }}>
            <div className="stack" style={{ gap: 0 }}>
              <span className="stat-label">اسم الحساب</span>
              <strong>{bank.accountName ?? '·'}</strong>
            </div>
            <div className="stack" style={{ gap: 0 }}>
              <span className="stat-label">البنك</span>
              <strong>{bank.bankName ?? '·'}</strong>
            </div>
            <div className="stack" style={{ gap: 0 }}>
              <span className="stat-label">الآيبان</span>
              {/* In fours, which is how it is read off a screen and typed into a bank app. */}
              <strong className="mono" dir="ltr" data-role="bank-iban">
                {ibanGroups(bank.iban ?? '')}
              </strong>
            </div>
            {bank.note === null ? null : (
              <p className="stat-hint" style={{ margin: 0 }}>
                {bank.note}
              </p>
            )}
          </div>
        ) : (
          <p className="notice notice-refused" data-role="bank-unknown" style={{ margin: 0 }}>
            بيانات الحساب البنكي غير مضبوطة في هذا النشر. أرسل الطلب وسنتواصل معك ببيانات
            التحويل.
          </p>
        )}
      </Card>

      <form action={action} id="checkout-form" className="row" style={{ gap: 'var(--s-3)' }}>
        {bundleCode === null || bundleCode === undefined ? null : (
          <input type="hidden" name="bundle_code" value={bundleCode} />
        )}
        {amountHalalas === null || amountHalalas === undefined ? null : (
          <input type="hidden" name="amount_halalas" value={String(amountHalalas)} />
        )}
        <SubmitButton variant="primary" data-role="checkout-submit" pendingLabel="جارٍ الإرسال">
          أرسل الطلب
        </SubmitButton>
        <Link className="btn btn-ghost" href={backHref} data-role="checkout-back">
          رجوع
        </Link>
      </form>

      <p className="stat-hint" style={{ margin: 0 }}>
        إرسال الطلب لا يخصم شيئاً. يصل الطلب إلينا برقم مرجعي، وعند وصول الحوالة نؤكّده فيظهر
        الرصيد في محفظتك.
      </p>
    </div>
  );
}

/**
 * The reference, straight after the request is made.
 *
 * One number, as large as the screen allows, because it is the only thing that has to survive
 * the walk to a banking app. Everything else on this screen is a reminder.
 */
export function CheckoutDone({
  reference,
  grossHalalas,
  bank,
}: {
  reference: string;
  grossHalalas: number;
  bank: CheckoutBank;
}): ReactElement {
  return (
    <Card role="checkout-done" labelledBy="checkout-done-title">
      <h2 className="card-title" id="checkout-done-title">
        وصلنا طلبك
      </h2>
      <div className="stack" style={{ gap: 'var(--s-3)' }}>
        <div className="stack" style={{ gap: 0 }}>
          <span className="stat-label">ضع هذا الرقم في بيان الحوالة</span>
          <strong className="mono checkout-reference" dir="ltr" data-role="topup-reference">
            {reference}
          </strong>
        </div>
        <div className="stack" style={{ gap: 0 }}>
          <span className="stat-label">المبلغ</span>
          <strong className="mono" dir="ltr">
            {riyals(grossHalalas)} ر.س
          </strong>
        </div>
        {bank.iban === null || bank.iban === '' ? null : (
          <div className="stack" style={{ gap: 0 }}>
            <span className="stat-label">الآيبان</span>
            <strong className="mono" dir="ltr">
              {ibanGroups(bank.iban)}
            </strong>
          </div>
        )}
        <p className="stat-hint" style={{ margin: 0 }}>
          بعد وصول الحوالة نؤكّد الطلب ويظهر الرصيد في محفظتك. تتابع حالة الطلب من «الفواتير
          والإيصالات».
        </p>
        <div className="row" style={{ gap: 'var(--s-3)' }}>
          <Link className="btn btn-secondary" href="/billing/invoices">
            الفواتير والإيصالات
          </Link>
          <Link className="btn btn-ghost" href="/billing">
            الباقة والرصيد
          </Link>
        </div>
      </div>
    </Card>
  );
}
