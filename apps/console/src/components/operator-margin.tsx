import type { ReactElement } from 'react';
import type { MarginTotals, Page } from '@nx-verify/core';
import { PageHeader } from './page-header';
import { Card, CardEmpty, CardHead } from './ui/card';
import { Ltr } from './ui/ltr';
import { NoValue } from './ui/no-value';
import { Stat, StatGrid } from './ui/stat';
import { Table, Th } from './ui/table';
import { count, isoMonth, riyals } from './format';
import { ListPagination } from './ui/pagination';
import type { SearchParams } from '../lib/pagination';

/**
 * What each customer earns us, by service.
 *
 * An operator screen, behind an operator token and an operator connection, and the only
 * screen in this console that crosses subscribers. The numbers come from aggregated
 * counters rather than from runs, so the query behind it cannot reach an entity or a
 * decision even by accident.
 *
 * Two figures here are easy to get wrong and are spelled out rather than computed away.
 * Work the package covered earns nothing this month and costs us everything, so it is
 * shown as its own column rather than folded into revenue. And a margin on no revenue is
 * undefined rather than zero, because printing zero invites somebody to average it.
 *
 * Every tile carries its unit. Three of the four are money and the fourth is a number of
 * operations, and a bare figure in that row reads as riyals to anybody scanning it.
 */

export interface MarginRowView {
  tenantName: string;
  productNameAr: string;
  periodStart: Date;
  runs: number;
  packageRuns: number;
  billedHalalas: number;
  providerCostHalalas: number;
  grossHalalas: number;
  marginPct: number | null;
}

export function OperatorMargin({
  page,
  totals,
  params,
}: {
  page: Page<MarginRowView>;
  /** Over every row of the report, not the page on screen. */
  totals: MarginTotals;
  params: SearchParams;
}): ReactElement {
  const rows = page.rows;
  const billed = totals.billedHalalas;
  const cost = totals.providerCostHalalas;
  const covered = totals.packageRuns;

  return (
    <div className="admin-screen" data-role="operator-margin">
      <PageHeader
        title="الهامش"
        subtitle="ما حصّلناه وما دفعناه للمزودين، لكل مشترك ولكل خدمة. من عدّادات مجمّعة لا من التشغيلات."
      />

      <StatGrid role="margin-tiles">
        <Stat
          label="المحصّل"
          value={
            <>
              <Ltr>{riyals(billed)}</Ltr> ر.س
            </>
          }
          hint="بلا ضريبة"
        />
        <Stat
          label="تكلفة المزودين"
          value={
            <>
              <Ltr>{riyals(cost)}</Ltr> ر.س
            </>
          }
        />
        <Stat
          label="الهامش"
          value={
            billed === 0 ? 'لا إيراد' : <Ltr>{Math.round(((billed - cost) / billed) * 100)}%</Ltr>
          }
          hint={
            <>
              <Ltr>{riyals(billed - cost)}</Ltr> ر.س
            </>
          }
        />
        <Stat
          label="غطّتها الباقات"
          value={
            <>
              <Ltr>{count(covered)}</Ltr> عملية
            </>
          }
          hint="عمليات لا تُحصَّل هذا الشهر"
        />
      </StatGrid>

      <Card variant="flush" role="margin-detail" labelledBy="margin-detail-title">
        <CardHead
          title="التفصيل"
          titleId="margin-detail-title"
          note={
            <>
              <Ltr>{count(page.total)}</Ltr> سطراً
            </>
          }
        />

        {page.total === 0 ? (
          <CardEmpty>لا استهلاك مسجّل في هذه الفترة.</CardEmpty>
        ) : (
          <div className="admin-table">
            <Table label="تفصيل الهامش">
              <thead>
                <tr>
                  <Th>الشهر</Th>
                  <Th>المشترك</Th>
                  <Th>الخدمة</Th>
                  <Th>العمليات</Th>
                  <Th>بالباقة</Th>
                  <Th>المحصّل</Th>
                  <Th>التكلفة</Th>
                  <Th>الهامش</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.periodStart.getTime()}-${row.tenantName}-${row.productNameAr}`}
                    data-role="margin-row"
                  >
                    <td>
                      <Ltr>{isoMonth(row.periodStart)}</Ltr>
                    </td>
                    <td>{row.tenantName}</td>
                    <td>{row.productNameAr}</td>
                    <td>
                      <Ltr>{count(row.runs)}</Ltr>
                    </td>
                    <td>
                      <Ltr>{count(row.packageRuns)}</Ltr>
                    </td>
                    <td>
                      <Ltr>{riyals(row.billedHalalas)}</Ltr>
                    </td>
                    <td>
                      <Ltr>{riyals(row.providerCostHalalas)}</Ltr>
                    </td>
                    <td data-role="margin-cell">
                      {row.marginPct === null ? (
                        // Undefined, not zero. A report that prints zero here invites
                        // somebody to average it.
                        <NoValue>لا إيراد</NoValue>
                      ) : (
                        <Ltr>{row.marginPct}%</Ltr>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <ListPagination
              page={page}
              path="/operator/reports"
              params={params}
              label="صفحات تقرير الهامش"
            />
          </div>
        )}
      </Card>
    </div>
  );
}
