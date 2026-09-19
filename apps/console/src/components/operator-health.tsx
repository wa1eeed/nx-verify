import type { ReactElement } from 'react';
import { PageHeader } from './page-header';
import { Card } from './ui/card';
import { Ltr } from './ui/ltr';
import { Table, Th } from './ui/table';
import { StateTag, Tag } from './ui/tag';
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
 *
 * Red is kept for what already failed. A low balance and an unhealthy provider are things
 * to look at, so they are amber, and they are amber here in the same words and the same
 * tone the subscribers screen uses for them (CLAUDE.md, interface).
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
    <div className="admin-screen" data-role="operator-health">
      <PageHeader
        title="صحة الخدمة"
        subtitle={`آخر ${windowHours} ساعة. ما فعلته خدمتنا حين نُوديت، ورصيد كل مشترك. لا شيء هنا عمّن تحقّق منه أحد.`}
      />

      <section className="grid" data-role="health-tiles">
        <article className="stat" {...(failing.length > 0 ? { 'data-tone': 'critical' } : {})}>
          <span className="stat-label">مشتركون يرون فشلاً</span>
          <strong className="stat-value">
            <Ltr>{count(failing.length)}</Ltr>
          </strong>
        </article>
        <article className="stat" {...(lowBalance.length > 0 ? { 'data-tone': 'changed' } : {})}>
          <span className="stat-label">أرصدة منخفضة</span>
          <strong className="stat-value">
            <Ltr>{count(lowBalance.length)}</Ltr>
          </strong>
          <span className="stat-hint">توشك أن توقف العمل</span>
        </article>
        <article className="stat" {...(degraded.length > 0 ? { 'data-tone': 'changed' } : {})}>
          <span className="stat-label">مزودون غير أصحاء</span>
          <strong className="stat-value">
            <Ltr>{count(degraded.length)}</Ltr>
          </strong>
          <span className="stat-hint">عند مشتركين مرتبطين بهم</span>
        </article>
      </section>

      <Card variant="flush" role="health-subscribers" labelledBy="health-subscribers-title">
        <div className="admin-card-head">
          <h2 className="card-title admin-card-title" id="health-subscribers-title">
            المشتركون
          </h2>
          <p className="admin-card-note">الأسوأ أولاً</p>
        </div>

        {rows.length === 0 ? (
          <p className="admin-empty" data-role="empty-state">
            لا مشترك مفعّل بعد، فلا صحة خدمة تُقاس.
          </p>
        ) : (
          <div className="admin-table">
            <Table label="صحة خدمة المشتركين">
              <thead>
                <tr>
                  <Th>المشترك</Th>
                  <Th>نداءات</Th>
                  <Th>فشل</Th>
                  {/* The unit beside the column name, as «الرصيد (ر.س)» does: the figure is
                      milliseconds, and a bare 900 in this column read as seconds. */}
                  <Th>أبطأ نداء (مللي ثانية)</Th>
                  <Th>الرصيد (ر.س)</Th>
                  <Th>المزودون</Th>
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
                      {row.legalName}{' '}
                      {row.isSandbox ? <Tag tone="neutral">بيئة اختبار</Tag> : null}
                      <div className="faint">
                        <Ltr>{row.slug}</Ltr>
                      </div>
                    </td>
                    <td>
                      <Ltr>{count(row.calls)}</Ltr>
                    </td>
                    <td>
                      {row.failures === 0 ? (
                        <Ltr>{count(row.failures)}</Ltr>
                      ) : (
                        <Tag tone="critical">
                          <Ltr>{count(row.failures)}</Ltr>
                        </Tag>
                      )}
                    </td>
                    <td>
                      {/* Nothing was called, so the slowest call is not zero milliseconds: it
                          does not exist. Printing 0 here reads as an instant answer. */}
                      {row.calls === 0 ? (
                        <span className="muted">لا نداءات</span>
                      ) : (
                        <Ltr>{count(row.slowestMs)}</Ltr>
                      )}
                    </td>
                    <td>
                      <Ltr>{riyals(row.balanceHalalas)}</Ltr>{' '}
                      {row.balanceLow ? (
                        <StateTag state="LOW_BALANCE" role="low-balance">
                          منخفض
                        </StateTag>
                      ) : null}
                    </td>
                    <td>
                      {row.unhealthyProviders.length === 0 ? (
                        <span className="muted">أصحّاء</span>
                      ) : (
                        // The provider name is internal, and this is the operator screen:
                        // the one place in the console where naming one is allowed.
                        <Tag tone="accent" role="unhealthy-provider">
                          <Ltr>{row.unhealthyProviders.join('، ')}</Ltr>
                        </Tag>
                      )}
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
