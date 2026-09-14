import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';
import { count, riyals } from './format';

/**
 * Every verification that ran, with its reference.
 *
 * The question this screen answers is the one an auditor asks: what was checked, for
 * whom, when, by what route, and what it cost. Each row links to the customer file it
 * changed, and the reference is the one printed on the evidence and quoted on the phone.
 *
 * Filters are links and a plain form, so a filtered view is an address that can be sent to
 * a colleague.
 */

export interface RunRowView {
  runId: string;
  reference: string | null;
  productNameAr: string;
  entityId: string | null;
  entityName: string | null;
  status: string;
  decision: string | null;
  triggeredBy: string;
  billedHalalas: number | null;
  chargeSource: string;
  createdAt: Date;
}

export interface VerificationsLogView {
  rows: RunRowView[];
  counts: { thisMonth: number; needsDecision: number; failed: number };
  products: { code: string; nameAr: string }[];
  filter: { product: string | null; status: string | null };
  /** A run to mark, when the screen was opened from a link that named one. */
  highlight: string | null;
  /** Every run, or only the ones that could not be carried out. */
  mode?: 'all' | 'failed';
}

export const RUN_STATUS_LABELS: Record<string, string> = {
  OK: 'مكتملة',
  PARTIAL: 'مكتملة جزئياً',
  NOT_FOUND: 'لا توجد بيانات',
  ERROR: 'تعذّر التنفيذ',
  AWAITING: 'بانتظار الرد',
  PENDING: 'قيد التنفيذ',
};

export const DECISION_LABELS: Record<string, string> = {
  PASS: 'مقبول',
  FAIL: 'مرفوض',
  REVIEW: 'يحتاج قراراً',
};

const TRIGGER_LABELS: Record<string, string> = {
  API: 'عبر الـAPI',
  CONSOLE: 'من المنصة',
  MONITOR: 'مراقبة دورية',
  BULK: 'دفعة',
};

function StatusBadge({ status }: { status: string }): ReactElement {
  const tone = status === 'OK' ? 'fresh' : status === 'ERROR' ? 'critical' : 'neutral';
  return (
    <span className="badge" data-tone={tone} data-status={status}>
      {RUN_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function DecisionBadge({ decision }: { decision: string | null }): ReactElement {
  if (decision === null) {
    return <span className="faint">بلا قرار</span>;
  }
  const tone = decision === 'PASS' ? 'fresh' : decision === 'FAIL' ? 'critical' : 'neutral';
  return (
    <span className="badge" data-tone={tone} data-decision={decision}>
      {DECISION_LABELS[decision] ?? decision}
    </span>
  );
}

export function VerificationsLog({ view }: { view: VerificationsLogView }): ReactElement {
  const failedOnly = view.mode === 'failed';
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title={failedOnly ? 'العمليات المتعثرة' : 'عمليات التحقق'}
        subtitle={
          failedOnly
            ? 'العمليات التي تعذّر تنفيذها. لا يُحتسب عليها رسم، وتُعاد من ملف العميل بزر القسم نفسه.'
            : 'كل عملية تحقق تمت على عملائك، بمرجعها ونتيجتها ورسمها.'
        }
        action={
          <a className="btn btn-primary" href="/verifications/new">
            تحقق جديد
          </a>
        }
      />

      <section className="grid" data-role="run-counts">
        <article className="stat">
          <span className="stat-label">عمليات هذا الشهر</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {count(view.counts.thisMonth)}
            </bdi>
          </strong>
        </article>
        <a className="stat stat-link" href="/customers/reviews">
          <span className="stat-label">تحتاج قراراً</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {count(view.counts.needsDecision)}
            </bdi>
          </strong>
          <span className="stat-hint">افتح قائمة المراجعة</span>
        </a>
        <article className="stat" {...(view.counts.failed > 0 ? { 'data-tone': 'critical' } : {})}>
          <span className="stat-label">تعذّر تنفيذها</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {count(view.counts.failed)}
            </bdi>
          </strong>
          <span className="stat-hint">لا يُحتسب عليها رسم</span>
        </article>
      </section>

      <Panel title="السجل" aside={`آخر ${view.rows.length}`} role="runs">
        <form
          method="get"
          action={failedOnly ? '/verifications/failed' : '/verifications'}
          className="panel-body row"
          style={{ gap: 'var(--s-3)' }}
        >
          <select
            name="product"
            defaultValue={view.filter.product ?? ''}
            aria-label="المنتج"
            style={{ width: 'auto' }}
          >
            <option value="">كل المنتجات</option>
            {view.products.map((product) => (
              <option key={product.code} value={product.code}>
                {product.nameAr}
              </option>
            ))}
          </select>
          {failedOnly ? null : (
            <select
              name="status"
              defaultValue={view.filter.status ?? ''}
              aria-label="النتيجة"
              style={{ width: 'auto' }}
            >
              <option value="">كل النتائج</option>
              {Object.entries(RUN_STATUS_LABELS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          )}
          <button type="submit" className="btn btn-secondary">
            تصفية
          </button>
        </form>

        {view.rows.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لا عمليات بهذه الشروط.</EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>المرجع</th>
                  <th>العميل</th>
                  <th>المنتج</th>
                  <th>النتيجة</th>
                  <th>القرار</th>
                  <th>المصدر</th>
                  <th>الوقت</th>
                  <th>الرسم (ريال)</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr
                    key={row.runId}
                    data-role="run-row"
                    {...(view.highlight === row.runId ? { 'data-highlight': 'yes' } : {})}
                  >
                    <td>
                      <bdi dir="ltr" className="mono">
                        {row.reference ?? '…'}
                      </bdi>
                    </td>
                    <td>
                      {row.entityId ? (
                        <a href={`/customers/${row.entityId}`}>{row.entityName ?? 'بلا اسم'}</a>
                      ) : (
                        <span className="faint">لم يُحدَّد</span>
                      )}
                    </td>
                    <td>{row.productNameAr}</td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td>
                      <DecisionBadge decision={row.decision} />
                    </td>
                    <td className="muted">{TRIGGER_LABELS[row.triggeredBy] ?? row.triggeredBy}</td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {row.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                      </bdi>
                    </td>
                    <td>
                      {row.chargeSource === 'PACKAGE' ? (
                        <span className="muted">من الباقة</span>
                      ) : row.chargeSource === 'BUNDLE' ? (
                        <span className="muted">من الحزمة</span>
                      ) : row.chargeSource === 'FREE' || row.billedHalalas === null ? (
                        <span className="muted">بلا رسم</span>
                      ) : (
                        <bdi dir="ltr" className="mono">
                          {riyals(row.billedHalalas)}
                        </bdi>
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
