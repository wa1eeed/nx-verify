import type { ReactElement } from 'react';
import { PageHeader, Panel } from './page-header';

/**
 * How to reach us, and what to bring.
 *
 * The request id is asked for first because it turns a support conversation from a
 * description into a lookup. Everything else on this screen is what the customer bought:
 * which support tier, what the platform promises, and where to send it.
 */

export interface SupportView {
  supportTier: string | null;
  packageNameAr: string | null;
  email: string;
  /** Hours within which a first response is promised for this tier. */
  responseHours: number;
}

const TIER_LABELS: Record<string, string> = {
  STANDARD: 'الدعم القياسي',
  PRIORITY: 'الدعم ذو الأولوية',
  DEDICATED: 'دعم مخصّص',
};

export function supportTierLabel(tier: string | null): string {
  return tier === null ? 'غير محدّد' : (TIER_LABELS[tier] ?? tier);
}

export function Support({ view }: { view: SupportView }): ReactElement {
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="الدعم"
        subtitle="ما تحتاجه قبل أن تراسلنا، وما نلتزم به بعد أن تفعل."
      />

      <section className="grid" data-role="support-tiles">
        <article className="stat">
          <span className="stat-label">مستوى الدعم</span>
          <strong className="stat-value" style={{ fontSize: '20px' }}>
            {supportTierLabel(view.supportTier)}
          </strong>
          {view.packageNameAr ? (
            <span className="stat-hint">ضمن باقة {view.packageNameAr}</span>
          ) : null}
        </article>
        <article className="stat">
          <span className="stat-label">أول رد</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {view.responseHours}
            </bdi>
          </strong>
          <span className="stat-hint">ساعة عمل</span>
        </article>
      </section>

      <Panel title="قبل أن تراسل" role="before-you-write">
        <ul className="panel-body stack" style={{ gap: 'var(--s-2)', margin: 0 }}>
          <li data-role="bring-request-id">
            أرسل <bdi dir="ltr" className="mono">request_id</bdi> من الاستجابة، أو مرجع
            التحقق <bdi dir="ltr" className="mono">VRF-…</bdi>. به نجد النداء في ثوانٍ بدل
            أن نطلب وصفه.
          </li>
          <li>
            راجع <a href="/logs?failures=1">النداءات الفاشلة</a> أولاً: الرمز هناك يقول ما
            حدث، وكثير منها يُحل بلا مراسلة.
          </li>
          <li data-role="never-send">
            لا ترسل رقم هوية ولا أي معرّف لشخص أو منشأة في البريد. لا نحتاجه، ولا نحتفظ
            به نصاً صريحاً، ووصوله إلى بريد يخالف ما بنينا المنصة عليه.
          </li>
        </ul>
      </Panel>

      <Panel title="العنوان" role="contact">
        <p className="panel-body">
          <bdi dir="ltr" className="mono">
            {view.email}
          </bdi>
        </p>
      </Panel>
    </div>
  );
}
