import type { ReactElement } from 'react';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Ltr } from './ui/ltr';
import { Notice } from './ui/notice';
import { SubmitButton } from './ui/submit-button';
import { Table, Th } from './ui/table';
import { riyals } from './format';

/**
 * What each provider call costs us (ADR-166).
 *
 * The number underneath every other number in this panel. The margin on the price table, the
 * margin per provider on the routing screen, the floor that refuses a price below cost, the
 * cheapest bundle operation the platform may sell: all of them are arithmetic on this table,
 * and until now the panel could only read it. The rates came from a seed file, so the margin
 * was correct for exactly as long as that file happened to match the contract.
 *
 * Two things this screen says that a bare list of numbers would not.
 *
 * **How many products a rate touches.** Raising one endpoint by a riyal is a different
 * decision when it is one product and when it is nine, and that figure is the difference
 * between a routine edit and one worth a second look.
 *
 * **Which calls have no cost at all.** A product whose cost is unknown has a margin the
 * platform is inventing and a floor that measures its price against zero. That belongs in
 * front of somebody, not in a blank cell they might not scroll to.
 *
 * Costs are versioned, so saving a rate closes the old row rather than editing it: a run
 * billed in March stays measurable against what that call cost in March.
 */

export interface ProviderCostView {
  provider: string;
  providerNameAr: string | null;
  endpoint: string;
  billedHalalas: number;
  vatBps: number;
  effectiveHalalas: number;
  usedByProducts: number;
}

export interface UnpricedCallView {
  provider: string;
  providerNameAr: string | null;
  endpoint: string;
  usedByProducts: number;
}

export interface CostsView {
  costs: readonly ProviderCostView[];
  unpriced: readonly UnpricedCallView[];
  /** True once the platform is VAT registered, when a provider's tax stops being a cost. */
  vatRegistered: boolean;
  canEdit: boolean;
  notice: { tone: 'done' | 'refused'; text: string } | null;
}

/** «واثق · corporate_full», or the code alone when the catalogue has no name for it. */
function callLabel(row: { providerNameAr: string | null; provider: string; endpoint: string }): string {
  return `${row.providerNameAr ?? row.provider} · ${row.endpoint}`;
}

export function OperatorCosts({
  view,
  saveAction,
}: {
  view: CostsView;
  saveAction: (formData: FormData) => void | Promise<void>;
}): ReactElement {
  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      {view.notice === null ? null : (
        <Notice tone={view.notice.tone} role="costs-notice">
          {view.notice.text}
        </Notice>
      )}

      <Card role="costs-explainer" labelledBy="costs-explainer-title">
        <h2 className="card-title admin-card-title" id="costs-explainer-title">
          تكلفة النداء عند المزوّد
        </h2>
        <p className="admin-card-note">
          هذا هو الرقم الذي تُحسب عليه كل الهوامش في اللوحة، والحدّ الذي لا ينزل تحته أي سعر.
          تُسجَّل بتاريخها: حفظ سعر جديد يُغلق السابق ولا يعدّله، فيبقى شهرٌ مضى مقيساً بتكلفته
          هو.
        </p>
        <p className="admin-card-note" data-role="costs-vat-note">
          {view.vatRegistered
            ? 'المنصة مسجّلة في الضريبة، فضريبة فاتورة المزوّد تُسترد ولا تُحتسب ضمن التكلفة.'
            : 'المنصة غير مسجّلة في الضريبة، فضريبة فاتورة المزوّد تكلفةٌ علينا بالكامل ولا تُسترد.'}
        </p>
      </Card>

      {/*
        Before the table, not after it: a call with no cost is the gap that makes a margin
        elsewhere a guess, and a reader who never scrolls past the priced rows would not see it.
      */}
      {view.unpriced.length === 0 ? null : (
        <Card role="unpriced-calls" labelledBy="unpriced-title">
          <h2 className="card-title admin-card-title" id="unpriced-title">
            نداءات بلا تكلفة مسجّلة
          </h2>
          <p className="admin-card-note">
            هامش كل منتج يستعمل هذه النداءات محسوبٌ على صفر، والحدّ الذي يمنع البيع تحت التكلفة
            لا يحميه شيء.
          </p>
          <ul className="admin-offer-list">
            {view.unpriced.map((call) => (
              <li
                key={`${call.provider}:${call.endpoint}`}
                className="admin-offer"
                data-role="unpriced-call"
              >
                <span className="stack" style={{ gap: 0, flex: 1 }}>
                  <strong>{callLabel(call)}</strong>
                  <span className="faint">
                    يستعمله <Ltr>{call.usedByProducts}</Ltr> من منتجات التحقق
                  </span>
                </span>
                {view.canEdit ? (
                  <form action={saveAction} className="row" style={{ gap: 'var(--s-2)' }}>
                    <input type="hidden" name="provider" value={call.provider} />
                    <input type="hidden" name="endpoint" value={call.endpoint} />
                    <input type="hidden" name="vat_pct" value="15" />
                    <Input
                      name="cost"
                      placeholder="0.00"
                      inputMode="decimal"
                      aria-label={`تكلفة ${callLabel(call)} بالريال`}
                      ltr
                    />
                    <SubmitButton variant="secondary" pendingLabel="جارٍ الحفظ">
                      سجّلها
                    </SubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card variant="flush" role="cost-table" labelledBy="cost-table-title">
        <div className="admin-card-head">
          <h2 className="card-title admin-card-title" id="cost-table-title">
            التكاليف السارية
          </h2>
          <p className="admin-card-note">
            المبلغ الذي يفوتره المزوّد للنداء الواحد، شاملاً ضريبته
          </p>
        </div>

        {view.costs.length === 0 ? (
          <p className="admin-empty" data-role="empty-state">
            لا تكلفة مسجّلة بعد. كل هامش في اللوحة محسوبٌ على صفر حتى تُسجَّل.
          </p>
        ) : (
          <div className="admin-table">
            <Table label="تكاليف المزودين">
              <thead>
                <tr>
                  <Th>النداء</Th>
                  <Th>يستعمله</Th>
                  <Th>ما يفوتره المزوّد</Th>
                  <Th>تكلفته علينا</Th>
                  <Th>ضريبة المزوّد</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {view.costs.map((cost) => (
                  <tr
                    key={`${cost.provider}:${cost.endpoint}`}
                    data-role="cost-row"
                    data-call={`${cost.provider}:${cost.endpoint}`}
                  >
                    <td>{callLabel(cost)}</td>
                    <td>
                      {/* The blast radius of a rate change, beside the rate. */}
                      <Ltr>{cost.usedByProducts}</Ltr> منتج
                    </td>
                    <td>
                      <Ltr>{riyals(cost.billedHalalas)}</Ltr> ر.س
                    </td>
                    <td data-role="effective-cost">
                      <span className="stack" style={{ gap: 0 }}>
                        <span>
                          <Ltr>{riyals(cost.effectiveHalalas)}</Ltr> ر.س
                        </span>
                        {cost.effectiveHalalas === cost.billedHalalas && cost.vatBps > 0 ? (
                          <span className="admin-sub">ضريبته لا تُسترد اليوم</span>
                        ) : null}
                      </span>
                    </td>
                    <td>
                      <Ltr>{(cost.vatBps / 100).toFixed(0)}%</Ltr>
                    </td>
                    <td>
                      {view.canEdit ? (
                        <form action={saveAction} className="row" style={{ gap: 'var(--s-2)' }}>
                          <input type="hidden" name="provider" value={cost.provider} />
                          <input type="hidden" name="endpoint" value={cost.endpoint} />
                          <input
                            type="hidden"
                            name="vat_pct"
                            value={String(cost.vatBps / 100)}
                          />
                          <Input
                            name="cost"
                            defaultValue={(cost.billedHalalas / 100).toFixed(2)}
                            inputMode="decimal"
                            aria-label={`تكلفة ${callLabel(cost)} بالريال`}
                            ltr
                          />
                          <SubmitButton variant="secondary" pendingLabel="جارٍ الحفظ">
                            حفظ
                          </SubmitButton>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
