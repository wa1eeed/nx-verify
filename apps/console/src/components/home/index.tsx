import Link from 'next/link';
import type { ReactElement } from 'react';
import { LinkedRows } from '../ui/linked-rows';
import type { HomeOverview } from '@nx-verify/core';
import { ButtonLink } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { Ltr } from '../ui/ltr';
import { ProgressBar } from '../ui/progress-bar';
import { Table, Th } from '../ui/table';
import { Tag } from '../ui/tag';
import { count } from '../format';
import {
  consumptionBars,
  costAr,
  customerAr,
  greetingAr,
  packageLine,
  performanceAr,
  runDayAr,
  runStatus,
  updatedAr,
} from './model';
import { QuickStart } from './quick-start';

/**
 * The subscriber's home screen (handoff screen 01).
 *
 * The greeting with the report and a new verification facing it; four figures (verified
 * customers, incomplete files, conflicts, the package); a bar that starts a verification
 * from a number; then the latest operations beside what the month consumed. The balance
 * sits at the foot of the sidebar, drawn by the frame.
 */

function Stat({
  label,
  value,
  line,
  tone,
  role,
}: {
  label: string;
  value: number;
  line: string;
  /** A figure that asks for attention reads in the accent, and only while it is not zero. */
  tone?: 'fresh' | 'attention' | undefined;
  role: string;
}): ReactElement {
  return (
    <Card as="div" variant="stat" role={role}>
      <p className="home-stat-label">{label}</p>
      <p
        className="home-stat-value"
        data-tone={tone === 'attention' && value > 0 ? 'attention' : undefined}
      >
        <Ltr>{count(value)}</Ltr>
      </p>
      <p
        className="home-stat-line"
        data-tone={tone === 'attention' && value === 0 ? undefined : tone}
      >
        {line}
      </p>
    </Card>
  );
}

export function HomeScreen({ overview, now }: { overview: HomeOverview; now: Date }): ReactElement {
  const pack = packageLine(overview.commitment, now);
  const bars = consumptionBars(overview.consumption);
  const performance = performanceAr(overview.performance);
  const { customers } = overview;

  return (
    <div className="home" data-role="home">
      <header className="page-head home-head" data-role="page-header">
        <div className="page-head-text">
          <h1 className="page-title">{greetingAr(overview.subscriberName, now)}</h1>
          <p className="page-subtitle">{updatedAr(overview.dataUpdatedAt, now)}</p>
        </div>
        <div className="page-head-actions">
          <ButtonLink href="/dashboard/report" icon="download" download data-role="export-report">
            تصدير التقرير
          </ButtonLink>
          <ButtonLink
            href="/verifications/new"
            variant="primary"
            icon="plus"
            data-role="new-verification"
          >
            تحقق جديد
          </ButtonLink>
        </div>
      </header>

      <section className="home-stats" aria-label="أرقام العملاء والباقة" data-role="tiles">
        <Stat
          role="verified-customers"
          label="عملاء متحققون"
          value={customers.verified}
          line={`+${count(customers.verifiedThisMonth)} هذا الشهر`}
          tone="fresh"
        />
        <Stat
          role="incomplete-files"
          label="ملفات ناقصة"
          value={customers.incomplete}
          line="بحاجة قسم واحد أو أكثر"
        />
        <Stat
          role="conflicts"
          label="تنبيهات تعارض"
          value={customers.conflicts}
          line={customers.conflicts > 0 ? 'تحتاج مراجعة يدوية' : 'لا تعارض بانتظار المراجعة'}
          tone="attention"
        />
        <Card as="div" variant="stat" tone="accent-2" role="package">
          {pack === null ? (
            <>
              <p className="home-stat-label" data-tone="fresh">
                الباقة
              </p>
              <p className="home-package-value">لا باقة مفعّلة</p>
              <p className="home-stat-line" data-tone="fresh">
                <Link href="/billing">الاشتراك والرصيد</Link>
              </p>
            </>
          ) : (
            <>
              <p className="home-stat-label" data-tone="fresh">
                {pack.nameAr}
              </p>
              <p className="home-package-value">{pack.endsAr}</p>
              <p className="home-stat-line" data-tone="fresh">
                {pack.leftAr}
              </p>
            </>
          )}
        </Card>
      </section>

      <Card as="section" variant="flush" label="ابدأ تحققاً جديداً" role="quick-start-card">
        <div className="home-start">
          <div className="home-start-text">
            <CardTitle as="h2">ابدأ تحققاً جديداً</CardTitle>
            <p className="home-start-line">
              أدخل رقم السجل التجاري أو رقم الهوية، وستفتح شاشة اختيار منتجات التحقق
            </p>
          </div>
          <QuickStart />
        </div>
      </Card>

      <div className="home-grid">
        <Card as="section" label="أحدث عمليات التحقق" role="recent-runs">
          <div className="home-card-head">
            <CardTitle as="h2">أحدث عمليات التحقق</CardTitle>
            <Link href="/verifications" className="home-card-link">
              عرض السجل كاملاً
            </Link>
          </div>
          {overview.recent.length === 0 ? (
            <p className="home-empty" data-role="empty-state">
              لا عمليات تحقق بعد. ابدأ بإدخال رقم عميل أعلاه.
            </p>
          ) : (
            <Table label="أحدث عمليات التحقق">
              <thead>
                <tr>
                  <Th>العميل</Th>
                  <Th>المنتج</Th>
                  <Th>الحالة</Th>
                  <Th>التاريخ</Th>
                  <Th>التكلفة</Th>
                </tr>
              </thead>
              <LinkedRows>
                {overview.recent.map((run) => {
                  const status = runStatus(run);
                  const cost = costAr(run);
                  return (
                    <tr
                      key={run.runId}
                      data-run={run.runId}
                      {...(run.entityId ? { 'data-href': `/customers/${run.entityId}` } : {})}
                    >
                      <td>
                        {run.entityId ? (
                          <Link
                            prefetch={false}
                            href={`/customers/${run.entityId}`}
                            className="row-link-quiet"
                            data-row-link
                          >
                            {customerAr(run)}
                          </Link>
                        ) : (
                          customerAr(run)
                        )}
                      </td>
                      <td>{run.productNameAr}</td>
                      <td>
                        <Tag tone={status.tone} role="run-status">
                          {status.text}
                        </Tag>
                      </td>
                      <td>{runDayAr(run)}</td>
                      <td>
                        {cost.riyals === null ? (
                          cost.wordsAr
                        ) : (
                          <>
                            <Ltr>{cost.riyals}</Ltr> ر.س
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </LinkedRows>
            </Table>
          )}
        </Card>

        <Card as="section" label="استهلاك المنتجات هذا الشهر" role="consumption">
          <div className="home-consumption">
            <CardTitle as="h2">استهلاك المنتجات هذا الشهر</CardTitle>
            {bars.length === 0 ? (
              <p className="home-empty" data-role="empty-state">
                لا عمليات هذا الشهر بعد.
              </p>
            ) : (
              <ul className="home-bars">
                {bars.map((bar) => (
                  <li key={bar.productCode} className="home-bar" data-product={bar.productCode}>
                    <div className="home-bar-line">
                      <span>{bar.nameAr}</span>
                      <span className="home-bar-count">
                        <Ltr>{bar.countAr}</Ltr>
                      </span>
                    </div>
                    <ProgressBar
                      value={Math.round(bar.share * 100)}
                      max={100}
                      label={`استهلاك ${bar.nameAr} هذا الشهر`}
                      tone={bar.tone}
                      size="thick"
                    />
                  </li>
                ))}
              </ul>
            )}
            {performance === null ? null : (
              <p className="home-note" data-role="performance">
                {performance}
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
