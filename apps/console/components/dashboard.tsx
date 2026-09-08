import type { ReactElement } from 'react';
import { FreshnessBadge } from './freshness';

/**
 * The risk dashboard.
 *
 * Two things are kept apart on this screen for the same reason they are kept apart
 * everywhere else: fields that aged out are not a problem with the portfolio, and changes
 * we detected are. Showing them as one number would be the most misleading figure on the
 * page.
 */

export interface DashboardView {
  entities: number;
  entitiesWithExpired: number;
  fieldFreshness: { fresh: number; expiring: number; expired: number; permanent: number };
  openChanges: { critical: number; warning: number; info: number };
  reviewQueue: { open: number; overdue: number; awaitingApproval: number };
  wallet: { balance: number; isLow: boolean };
  monitors: { active: number; budgetExhausted: number };
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string | undefined;
}): ReactElement {
  return (
    <article className="card stack" style={{ gap: '4px' }}>
      <span className="muted">{label}</span>
      <strong style={{ fontSize: '26px' }}>
        <bdi dir="ltr" className="mono">
          {value}
        </bdi>
      </strong>
      {hint ? <span className="muted">{hint}</span> : null}
    </article>
  );
}

export function Dashboard({ view }: { view: DashboardView }): ReactElement {
  return (
    <div className="stack">
      <h1>لوحة المخاطر</h1>

      <section className="grid" data-role="tiles">
        <Tile label="الكيانات" value={view.entities} />
        <Tile
          label="كيانات فيها حقل منتهي الصلاحية"
          value={view.entitiesWithExpired}
          hint="معرفتنا قديمة. لا يعني ذلك وجود مشكلة."
        />
        <Tile
          label="تغيّرات حرجة لم تُعالَج"
          value={view.openChanges.critical}
          hint="تحققنا واكتشفنا اختلافاً."
        />
        <Tile label="حالات مراجعة مفتوحة" value={view.reviewQueue.open} />
        <Tile label="حالات متأخرة" value={view.reviewQueue.overdue} />
        <Tile label="بانتظار الاعتماد" value={view.reviewQueue.awaitingApproval} />
        <Tile
          label="الرصيد بالريال"
          value={(view.wallet.balance / 100).toFixed(2)}
          hint={view.wallet.isLow ? 'الرصيد منخفض' : undefined}
        />
        <Tile
          label="مراقبات نشطة"
          value={view.monitors.active}
          hint={
            view.monitors.budgetExhausted > 0
              ? `${view.monitors.budgetExhausted} تجاوزت سقفها`
              : undefined
          }
        />
      </section>

      <section className="card stack" data-role="freshness">
        <strong>توزيع الحداثة</strong>
        <div className="row" style={{ gap: '16px', flexWrap: 'wrap' }}>
          <span className="row">
            <FreshnessBadge state="fresh" />
            <bdi dir="ltr" className="mono">
              {view.fieldFreshness.fresh}
            </bdi>
          </span>
          <span className="row">
            <FreshnessBadge state="expiring" />
            <bdi dir="ltr" className="mono">
              {view.fieldFreshness.expiring}
            </bdi>
          </span>
          <span className="row">
            <FreshnessBadge state="expired" />
            <bdi dir="ltr" className="mono">
              {view.fieldFreshness.expired}
            </bdi>
          </span>
        </div>
      </section>

      <div className="row">
        <a className="btn-primary" href="/queue">
          افتح طابور المراجعة
        </a>
      </div>
    </div>
  );
}
