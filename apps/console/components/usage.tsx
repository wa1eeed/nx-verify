import type { ReactElement } from 'react';
import { PageHeader, Panel } from './page-header';

/**
 * What the workspace bought and what is left of it.
 *
 * The two numbers a subscriber asks for are how much capacity remains and which modules
 * they may run, and both are shown before anything else. A module that is off says why it
 * is off, because "not included in your package" is a sentence somebody can act on and a
 * greyed row is not.
 */

export interface EntitlementView {
  productCode: string;
  nameAr: string;
  allowed: boolean;
  refusal: string | null;
  quota: number | null;
  used: number;
  remaining: number | null;
  negotiated: boolean;
}

export interface UsageView {
  packageNameAr: string | null;
  packageCode: string | null;
  status: string | null;
  termStart: Date | null;
  termEnd: Date | null;
  includedTransactions: number | null;
  transactionsUsed: number;
  balanceHalalas: number;
  heldHalalas: number;
  availableHalalas: number;
  isLow: boolean;
  entitlements: EntitlementView[];
}

const REFUSAL_LABELS: Record<string, string> = {
  NO_SUBSCRIPTION: 'لا توجد باقة مفعّلة',
  SUBSCRIPTION_INACTIVE: 'الاشتراك غير نشط',
  PRODUCT_NOT_IN_PACKAGE: 'غير مشمولة في باقتك',
  PRODUCT_DISABLED: 'معطّلة لمساحة عملك',
  QUOTA_EXHAUSTED: 'استُنفدت الحصة لهذه الدورة',
  CAPACITY_EXHAUSTED: 'استُنفدت سعة الالتزام',
};

export function refusalLabel(refusal: string | null): string {
  return refusal === null ? '' : (REFUSAL_LABELS[refusal] ?? refusal);
}

function riyals(halalas: number): string {
  return (halalas / 100).toFixed(2);
}

export function Usage({ view }: { view: UsageView }): ReactElement {
  const capacityLeft =
    view.includedTransactions === null
      ? null
      : Math.max(0, view.includedTransactions - view.transactionsUsed);

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="الاستهلاك والباقة"
        subtitle={
          view.packageNameAr
            ? `باقة ${view.packageNameAr}. الأرقام أدناه لهذه المدة، ولا تشمل الضريبة.`
            : 'لا توجد باقة مفعّلة لمساحة العمل هذه.'
        }
      />

      <section className="grid" data-role="usage-tiles">
        <article className="stat">
          <span className="stat-label">السعة المتبقية</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {capacityLeft === null ? 'بلا حد' : capacityLeft}
            </bdi>
          </strong>
          {view.includedTransactions === null ? (
            <span className="stat-hint">الرصيد وحده هو الحد</span>
          ) : (
            <span className="stat-hint">
              من {view.includedTransactions} عملية في هذه المدة
            </span>
          )}
        </article>

        <article className="stat" {...(view.isLow ? { 'data-tone': 'critical' } : {})}>
          <span className="stat-label">الرصيد المتاح</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {riyals(view.availableHalalas)}
            </bdi>
          </strong>
          <span className="stat-hint">
            محجوز لعمليات جارية: <bdi dir="ltr" className="mono">{riyals(view.heldHalalas)}</bdi>
          </span>
        </article>

        <article className="stat">
          <span className="stat-label">عمليات هذه المدة</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {view.transactionsUsed}
            </bdi>
          </strong>
          {view.termEnd ? (
            <span className="stat-hint">
              حتى <bdi dir="ltr" className="mono">{view.termEnd.toISOString().slice(0, 10)}</bdi>
            </span>
          ) : null}
        </article>
      </section>

      <Panel title="وحدات التحقق" aside="ما تشمله باقتك" role="entitlements">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>الوحدة</th>
                <th>الحالة</th>
                <th>الحصة الشهرية</th>
                <th>المستهلك</th>
              </tr>
            </thead>
            <tbody>
              {view.entitlements.map((entry) => (
                <tr key={entry.productCode} data-role="entitlement">
                  <td>
                    {entry.nameAr}
                    {entry.negotiated ? (
                      <span className="muted" data-role="negotiated">
                        {' '}
                        · مخصّصة لمساحة عملك
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {entry.allowed ? (
                      <span
                        className="badge"
                        data-role="enabled"
                        style={{ borderColor: 'var(--fresh-line)', color: 'var(--fresh-fg)' }}
                      >
                        مفعّلة
                      </span>
                    ) : (
                      // Why, not merely that: a sentence somebody can act on.
                      <span className="badge" data-role="disabled">
                        {refusalLabel(entry.refusal)}
                      </span>
                    )}
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {entry.quota === null ? 'بلا حد' : entry.quota}
                    </bdi>
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {entry.used}
                    </bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
