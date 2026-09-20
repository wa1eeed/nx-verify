import type { ReactElement } from 'react';
import { PageHeader } from './page-header';
import { Card, CardEmpty, CardHead } from './ui/card';
import { Ltr } from './ui/ltr';
import { NoValue } from './ui/no-value';
import { Stat, StatGrid } from './ui/stat';
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
  /**
   * What the wallet can pay for, as the domain works it out (`subscriberHealth`).
   *
   * Read rather than subtracted here. This column used to compute `balance − held` in the
   * markup while `balanceLow` arrived already decided from the domain's own subtraction: one
   * phrase, «الرصيد المتاح», defined twice, so a later change to what a hold means would have
   * reached the tag and not the figure beside it.
   */
  walletAvailableHalalas: number;
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

      <StatGrid role="health-tiles">
        <Stat
          label="مشتركون يرون فشلاً"
          value={<Ltr>{count(failing.length)}</Ltr>}
          tone={failing.length > 0 ? 'critical' : undefined}
        />
        <Stat
          label="أرصدة منخفضة"
          value={<Ltr>{count(lowBalance.length)}</Ltr>}
          hint="توشك أن توقف العمل"
          tone={lowBalance.length > 0 ? 'changed' : undefined}
        />
        <Stat
          label="مزودون غير أصحاء"
          value={<Ltr>{count(degraded.length)}</Ltr>}
          hint="عند مشتركين مرتبطين بهم"
          tone={degraded.length > 0 ? 'changed' : undefined}
        />
      </StatGrid>

      <Card variant="flush" role="health-subscribers" labelledBy="health-subscribers-title">
        <CardHead title="المشتركون" titleId="health-subscribers-title" note="الأسوأ أولاً" />

        {rows.length === 0 ? (
          <CardEmpty>لا مشترك مفعّل بعد، فلا صحة خدمة تُقاس.</CardEmpty>
        ) : (
          <div className="admin-table">
            <Table label="صحة خدمة المشتركين">
              <thead>
                <tr>
                  <Th>المشترك</Th>
                  <Th>نداءات</Th>
                  <Th>فشل</Th>
                  {/* The unit beside the column name, as «الرصيد المتاح (ر.س)» does: the figure
                      is milliseconds, and a bare 900 in this column read as seconds. */}
                  <Th>أبطأ نداء (مللي ثانية)</Th>
                  {/*
                    Available, not the gross balance. Part of a balance is held against
                    verifications already running, and the subscriber's own screen has always
                    shown what is left after that. This column showed the figure before the
                    hold, so support read one number off this screen while the customer read a
                    smaller one off theirs, and a row could carry «منخفض» beside a balance that
                    looked perfectly healthy.
                  */}
                  <Th>الرصيد المتاح (ر.س)</Th>
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
                      {row.legalName} {row.isSandbox ? <Tag tone="neutral">بيئة اختبار</Tag> : null}
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
                        <NoValue>لا نداءات</NoValue>
                      ) : (
                        <Ltr>{count(row.slowestMs)}</Ltr>
                      )}
                    </td>
                    <td>
                      <Ltr>{riyals(row.walletAvailableHalalas)}</Ltr>{' '}
                      {row.balanceLow ? (
                        <StateTag state="LOW_BALANCE" role="low-balance">
                          منخفض
                        </StateTag>
                      ) : null}
                      {row.heldHalalas > 0 ? (
                        <div className="faint" data-role="held">
                          محجوز لعمليات جارية: <Ltr>{riyals(row.heldHalalas)}</Ltr>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {row.unhealthyProviders.length === 0 ? (
                        <NoValue>أصحّاء</NoValue>
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
