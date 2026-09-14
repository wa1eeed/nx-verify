import type { ReactElement } from 'react';
import type { ApiLogTallies, Page } from '@nx-verify/core';
import { ListPagination } from './ui/pagination';
import type { SearchParams } from '../lib/pagination';
import { EmptyState, PageHeader, Panel } from './page-header';

/**
 * The calls, as the customer's own engineer needs to see them.
 *
 * Debugging starts with one question: what did you receive from us, and what did you send
 * back. So the failures are reachable in one click, the request id is the first column
 * because it is what support asks for, and the route is shown rather than the address,
 * which is also what is stored.
 */

export interface ApiLogRowView {
  id: string;
  requestId: string;
  method: string;
  route: string;
  status: number;
  latencyMs: number;
  errorCode: string | null;
  environment: string;
  at: Date;
}

export function ApiLog({
  page,
  tallies,
  params,
  failuresOnly,
}: {
  page: Page<ApiLogRowView>;
  /** Over every call the filter leaves, not the page on screen. */
  tallies: ApiLogTallies;
  params: SearchParams;
  failuresOnly: boolean;
}): ReactElement {
  const rows = page.rows;
  const failures = tallies.failures;
  const slowest = tallies.slowestMs;

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader title="سجل النداءات" subtitle="كل نداء وصلنا منك: المسار والحالة وزمن الرد." />

      <section className="grid" data-role="log-tiles">
        <article className="stat">
          <span className="stat-label">نداءات مسجّلة</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {tallies.total}
            </bdi>
          </strong>
        </article>
        <article className="stat" {...(failures > 0 ? { 'data-tone': 'critical' } : {})}>
          <span className="stat-label">فشل</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {failures}
            </bdi>
          </strong>
        </article>
        <article className="stat">
          <span className="stat-label">أبطأ نداء</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {slowest}
            </bdi>
          </strong>
          <span className="stat-hint">بالمللي ثانية</span>
        </article>
      </section>

      <nav className="tabs" aria-label="تصفية">
        <a
          className="tab"
          href="/settings/developers/logs"
          {...(failuresOnly ? {} : { 'aria-current': 'page' as const })}
        >
          الكل
        </a>
        <a
          className="tab"
          href="/settings/developers/logs?failures=1"
          {...(failuresOnly ? { 'aria-current': 'page' as const } : {})}
          data-role="failures-filter"
        >
          ما فشل فقط
        </a>
      </nav>

      <Panel title="النداءات" aside="الأحدث أولاً">
        {page.total === 0 ? (
          <div className="panel-body">
            <EmptyState>
              {failuresOnly ? 'لا نداءات فاشلة. هذه أخبار جيدة.' : 'لا نداءات بعد.'}
            </EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>معرّف الطلب</th>
                  <th>الطريقة</th>
                  <th>المسار</th>
                  <th>الحالة</th>
                  <th>الرمز</th>
                  <th>المدة</th>
                  <th>البيئة</th>
                  <th>الوقت</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    data-role="log-row"
                    data-failed={row.status >= 400 ? 'true' : 'false'}
                  >
                    <td>
                      <bdi dir="ltr" className="mono">
                        {row.requestId}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {row.method}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {row.route}
                      </bdi>
                    </td>
                    <td>
                      <bdi
                        dir="ltr"
                        className="mono"
                        style={row.status >= 400 ? { color: 'var(--critical-fg)' } : undefined}
                      >
                        {row.status}
                      </bdi>
                    </td>
                    <td>
                      {row.errorCode ? (
                        <bdi dir="ltr" className="mono">
                          {row.errorCode}
                        </bdi>
                      ) : (
                        <span className="muted">لا يوجد</span>
                      )}
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {row.latencyMs}
                      </bdi>
                    </td>
                    <td>
                      <span className="badge" data-role="log-environment">
                        {row.environment === 'live' ? 'إنتاج' : 'اختبار'}
                      </span>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {row.at.toISOString().slice(0, 19).replace('T', ' ')}
                      </bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="panel-body">
          <ListPagination
            page={page}
            path="/settings/developers/logs"
            params={params}
            label="صفحات سجل النداءات"
          />
        </div>
      </Panel>
    </div>
  );
}
