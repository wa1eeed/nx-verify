import type { ReactElement } from 'react';
import { FreshnessBadge } from './freshness';
import { EmptyState, PageHeader, Panel } from './page-header';

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

/**
 * A figure.
 *
 * The tone is the state the figure is in, and it only appears when the figure is not
 * zero: a dashboard where every tile is coloured is a dashboard where no colour means
 * anything. Expired keeps the neutral grey and a detected change keeps the warning, so
 * the two are never read as the same kind of trouble.
 */
function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number | string;
  hint?: string | undefined;
  tone?: 'critical' | 'changed' | 'expired' | undefined;
}): ReactElement {
  const lit = tone !== undefined && value !== 0 && value !== '0';
  return (
    <article className="stat" {...(lit ? { 'data-tone': tone } : {})}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">
        <bdi dir="ltr" className="mono">
          {value}
        </bdi>
      </strong>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </article>
  );
}

export function Dashboard({ view }: { view: DashboardView }): ReactElement {
  const quiet =
    view.openChanges.critical === 0 &&
    view.reviewQueue.open === 0 &&
    view.entitiesWithExpired === 0;

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="لوحة المخاطر"
        subtitle="ما يحتاج قراراً اليوم، وما تقادمت معرفتنا به. الاثنان ليسا الشيء نفسه."
        action={
          <a className="btn-primary" href="/queue">
            افتح طابور المراجعة
          </a>
        }
      />

      {quiet ? (
        <EmptyState>لا تغيّرات حرجة ولا حالات مفتوحة ولا حقول منتهية. لا شيء يحتاج قراراً الآن.</EmptyState>
      ) : null}

      <section className="grid" data-role="tiles">
        <Tile label="الكيانات" value={view.entities} />
        <Tile
          label="كيانات فيها حقل منتهي الصلاحية"
          value={view.entitiesWithExpired}
          hint="معرفتنا قديمة. لا يعني ذلك وجود مشكلة."
          tone="expired"
        />
        <Tile
          label="تغيّرات حرجة لم تُعالَج"
          value={view.openChanges.critical}
          hint="تحققنا واكتشفنا اختلافاً."
          tone="changed"
        />
        <Tile label="حالات مراجعة مفتوحة" value={view.reviewQueue.open} />
        <Tile label="حالات متأخرة" value={view.reviewQueue.overdue} tone="critical" />
        <Tile label="بانتظار الاعتماد" value={view.reviewQueue.awaitingApproval} />
        <Tile
          label="الرصيد بالريال"
          value={(view.wallet.balance / 100).toFixed(2)}
          hint={view.wallet.isLow ? 'الرصيد منخفض' : undefined}
          {...(view.wallet.isLow ? { tone: 'critical' as const } : {})}
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

      <Panel title="توزيع الحداثة" aside="الحقول، لا الكيانات" role="freshness">
        <div className="panel-body row" style={{ gap: 'var(--s-5)' }}>
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
      </Panel>
    </div>
  );
}
