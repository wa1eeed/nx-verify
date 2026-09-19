import type { ReactElement } from 'react';
import { PageHeader, Panel } from './page-header';
import { count, riyals } from './format';

/**
 * The screen support opens while the customer is still on the telephone.
 *
 * Three questions, in the order they are asked: are their calls failing, is their balance
 * about to stop them, and is the provider behind their checks healthy. The worst row is
 * first, because the person reading this is already in a hurry.
 *
 * It shows telemetry about our own service and money about their account, and nothing
 * about whom they verified. That boundary is the reason staff may look at all.
 */

export interface HealthRowView {
  tenantId: string;
  legalName: string;
  slug: string;
  isSandbox: boolean;
  calls: number;
  failures: number;
  slowestMs: number;
  balanceHalalas: number;
  heldHalalas: number;
  balanceLow: boolean;
  unhealthyProviders: string[];
}

export function OperatorHealth({
  rows,
  windowHours,
}: {
  rows: HealthRowView[];
  windowHours: number;
}): ReactElement {
  const failing = rows.filter((row) => row.failures > 0);
  const lowBalance = rows.filter((row) => row.balanceLow);
  const degraded = rows.filter((row) => row.unhealthyProviders.length > 0);

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="صحة الخدمة"
        subtitle={`آخر ${windowHours} ساعة. ما فعلته خدمتنا حين نُوديت، ورصيد كل مشترك. لا شيء هنا عمّن تحقّق منه أحد.`}
      />

      <section className="grid" data-role="health-tiles">
        <article className="stat" {...(failing.length > 0 ? { 'data-tone': 'critical' } : {})}>
          <span className="stat-label">مشتركون يرون فشلاً</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {count(failing.length)}
            </bdi>
          </strong>
        </article>
        <article className="stat" {...(lowBalance.length > 0 ? { 'data-tone': 'critical' } : {})}>
          <span className="stat-label">أرصدة منخفضة</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {count(lowBalance.length)}
            </bdi>
          </strong>
          <span className="stat-hint">توشك أن توقف العمل</span>
        </article>
        <article className="stat" {...(degraded.length > 0 ? { 'data-tone': 'changed' } : {})}>
          <span className="stat-label">مزودون غير أصحاء</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {count(degraded.length)}
            </bdi>
          </strong>
          <span className="stat-hint">عند مشتركين مرتبطين بهم</span>
        </article>
      </section>

      <Panel title="المشتركون" aside="الأسوأ أولاً">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>المشترك</th>
                <th>نداءات</th>
                <th>فشل</th>
                <th>أبطأ نداء</th>
                <th>الرصيد (ر.س)</th>
                <th>المزودون</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.tenantId}
                  data-role="health-row"
                  data-failing={row.failures > 0 ? 'true' : 'false'}
                >
                  <td>
                    {row.legalName}
                    {row.isSandbox ? <span className="muted"> · بيئة اختبار</span> : null}
                    <div className="faint">
                      <bdi dir="ltr" className="mono">
                        {row.slug}
                      </bdi>
                    </div>
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {count(row.calls)}
                    </bdi>
                  </td>
                  <td>
                    <bdi
                      dir="ltr"
                      className="mono"
                      style={row.failures > 0 ? { color: 'var(--critical-fg)' } : undefined}
                    >
                      {count(row.failures)}
                    </bdi>
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {count(row.slowestMs)}
                    </bdi>
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {riyals(row.balanceHalalas)}
                    </bdi>
                    {row.balanceLow ? (
                      <span
                        className="badge"
                        data-role="low-balance"
                        style={{
                          borderColor: 'var(--critical-line)',
                          color: 'var(--critical-fg)',
                          marginInlineStart: 'var(--s-2)',
                        }}
                      >
                        منخفض
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {row.unhealthyProviders.length === 0 ? (
                      <span className="muted">أصحّاء</span>
                    ) : (
                      // The provider name is internal, and this is the operator screen:
                      // the one place in the console where naming one is allowed.
                      <span className="badge" data-role="unhealthy-provider">
                        <bdi dir="ltr" className="mono">
                          {row.unhealthyProviders.join('، ')}
                        </bdi>
                      </span>
                    )}
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
