import type { ReactElement } from 'react';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Ltr } from '../ui/ltr';
import { SubmitButton } from '../ui/submit-button';
import { Table, Th } from '../ui/table';

/**
 * Value added tax, declared from a date (ADR-157).
 *
 * The screen exists because the obvious control is the wrong one. A switch marked «فعّل
 * الضريبة» flipped on the morning of registration recomputes every invoice ever issued with
 * tax that did not apply when it was charged, and a February invoice reprinted in April
 * becomes a different document from the one the customer received. So what is set here is a
 * rule and the day it starts, and every calculation reads the rule of its own date.
 *
 * It says the consequence in both directions before anybody presses anything, because the
 * two halves of the change are not obvious together: the subscriber's price gains a tax line,
 * and the tax inside a provider's bill stops being a cost. Margins move on both sides on the
 * same day, and somebody planning the date should see that here rather than discover it in
 * the margin column a month later.
 *
 * Nothing about the price book changes. Prices are stored without tax and always were, which
 * is what makes this a change of one rule rather than a rewrite of every price.
 */

export interface VatPeriodView {
  effectiveFrom: string;
  registered: boolean;
  ratePct: string;
  registrationNumber: string | null;
  note: string | null;
  setBy: string | null;
  /** True for the row that governs today. */
  current: boolean;
  /** True for a rule that has not started yet. */
  future: boolean;
}

export function VatPanel({
  periods,
  today,
  canEdit,
  action,
}: {
  periods: readonly VatPeriodView[];
  /** Today, as the default start date of a new rule. */
  today: string;
  canEdit: boolean;
  action: (formData: FormData) => void | Promise<void>;
}): ReactElement {
  const current = periods.find((period) => period.current);
  const registered = current?.registered ?? false;

  return (
    <Card role="vat" labelledBy="vat-title">
      <div className="admin-card-head">
        <h2 className="card-title admin-card-title" id="vat-title">
          ضريبة القيمة المضافة
        </h2>
        <p className="admin-card-note">
          تُعلَن من تاريخ، لا تُفعَّل بمفتاح: كل فاتورة تُحسب بقاعدة يومها، فلا يتغيّر ما صدر.
        </p>
      </div>

      <p className="admin-state" data-role="vat-state" data-registered={registered ? 'true' : 'false'}>
        {registered ? (
          <>
            المنصة مسجّلة اليوم بنسبة <Ltr>{current?.ratePct}%</Ltr>. السعر المعروض للمشترك يشمل
            الضريبة، وضريبة فواتير المزودين تُسترد فلا تُحتسب ضمن التكلفة.
          </>
        ) : (
          <>
            المنصة غير مسجّلة اليوم. لا تُضاف ضريبة على أسعار المشتركين، وضريبة فواتير المزودين
            تكلفةٌ علينا لا تُسترد.
          </>
        )}
      </p>

      {periods.length === 0 ? null : (
        <div className="admin-table">
          <Table label="فترات الضريبة">
            <thead>
              <tr>
                <Th>من تاريخ</Th>
                <Th>الحالة</Th>
                <Th>النسبة</Th>
                <Th>الرقم الضريبي</Th>
                <Th>ملاحظة</Th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr
                  key={period.effectiveFrom}
                  data-role="vat-period"
                  data-current={period.current ? 'true' : 'false'}
                  data-future={period.future ? 'true' : 'false'}
                >
                  <td>
                    <Ltr>{period.effectiveFrom}</Ltr>
                    {period.current ? (
                      <span className="badge" data-role="vat-current">
                        سارية
                      </span>
                    ) : null}
                    {period.future ? (
                      <span className="badge" data-tone="accent" data-role="vat-future">
                        لم تبدأ بعد
                      </span>
                    ) : null}
                  </td>
                  <td>{period.registered ? 'مسجّلة' : 'غير مسجّلة'}</td>
                  <td>
                    <Ltr>{period.registered ? `${period.ratePct}%` : '·'}</Ltr>
                  </td>
                  <td>
                    {period.registrationNumber === null ? (
                      <span className="admin-empty-cell">·</span>
                    ) : (
                      <Ltr>{period.registrationNumber}</Ltr>
                    )}
                  </td>
                  <td className="admin-sub">{period.note ?? '·'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {canEdit ? (
        <form action={action} className="stack admin-vat-form" style={{ gap: 'var(--space-3)' }}>
          <p className="admin-card-note">
            {/*
              The sentence somebody needs before they choose a date, not after. Registration is
              known weeks ahead, so a future date is the normal case and not an edge one.
            */}
            أعلن القاعدة من يومها. يمكن أن يكون التاريخ مستقبلياً، ولا يمكن أن يسبق فترةً
            مسجّلة، لأن ذلك يغيّر فواتير صدرت.
          </p>
          <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <label className="stack" style={{ gap: 'var(--space-1)' }}>
              <span className="stat-label">من تاريخ</span>
              <Input name="effective_from" type="date" defaultValue={today} required ltr />
            </label>
            <label className="stack" style={{ gap: 'var(--space-1)' }}>
              <span className="stat-label">الحالة</span>
              <select name="registered" defaultValue={registered ? 'true' : 'false'}>
                <option value="false">غير مسجّلة</option>
                <option value="true">مسجّلة</option>
              </select>
            </label>
            <label className="stack" style={{ gap: 'var(--space-1)' }}>
              <span className="stat-label">النسبة %</span>
              <Input
                name="rate_pct"
                defaultValue={current?.ratePct ?? '15'}
                inputMode="decimal"
                ltr
              />
            </label>
            <label className="stack" style={{ gap: 'var(--space-1)' }}>
              <span className="stat-label">الرقم الضريبي</span>
              <Input
                name="registration_number"
                defaultValue={current?.registrationNumber ?? ''}
                inputMode="numeric"
                placeholder="300000000000003"
                ltr
              />
            </label>
          </div>
          <label className="stack" style={{ gap: 'var(--space-1)' }}>
            <span className="stat-label">ملاحظة</span>
            <Input name="note" maxLength={200} />
          </label>
          <SubmitButton variant="secondary" data-role="save-vat" pendingLabel="جارٍ الحفظ">
            أعلن القاعدة
          </SubmitButton>
        </form>
      ) : null}
    </Card>
  );
}
