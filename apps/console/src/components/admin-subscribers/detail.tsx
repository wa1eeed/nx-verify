import Link from 'next/link';
import type { ReactElement } from 'react';
import type { SpecialPrice, SubscriberBoardRow, SubscriberDetail } from '@nx-verify/core';
import { PageHeader } from '../page-header';
import { Card } from '../ui/card';
import { Field } from '../ui/field';
import { Ltr } from '../ui/ltr';
import { Notice } from '../ui/notice';
import { Select } from '../ui/select';
import { SubmitButton } from '../ui/submit-button';
import { Table, Th } from '../ui/table';
import { Tag } from '../ui/tag';
import { count, dateAr, riyals, termPhrase } from '../format';
import { specialLineAr } from '../admin-pricing/model';
import { bundleLabelOf } from '../topup';
import { STANDING_TAGS, balanceCellAr, endsAr, planCellAr } from './model';

/**
 * One subscriber, managed (the «إدارة» link of handoff screen 06).
 *
 * What it is on and where it stands, the bundles it bought, the special prices that apply to
 * it, what it used this term and the transfers it asked for. Support and owners move it to
 * another plan or stop it; everybody else sees the same page without the controls.
 */

type Action = (formData: FormData) => Promise<void>;

const TOPUP_STATUS: Readonly<Record<string, string>> = {
  REQUESTED: 'بانتظار الحوالة',
  CONFIRMED: 'أُكّدت',
  REJECTED: 'لم تصل',
};

export interface AdminSubscriberView {
  detail: SubscriberDetail;
  row: SubscriberBoardRow;
  canManage: boolean;
  plans: readonly { code: string; nameAr: string }[];
  specialPrice: SpecialPrice | null;
  notice: { tone: 'done' | 'refused'; text: string } | null;
}

export function AdminSubscriber({
  view,
  actions,
}: {
  view: AdminSubscriberView;
  actions: { setSuspended: Action; assignPlan: Action };
}): ReactElement {
  const { detail, row } = view;
  const standing = STANDING_TAGS[row.standing];
  const suspended = row.status === 'suspended';

  return (
    <div className="admin-screen" data-role="admin-subscriber">
      <PageHeader
        title={detail.legalName}
        subtitle={`مشترك منذ ${dateAr(detail.createdAt)} · مساحة العمل ${detail.slug}`}
        action={
          view.canManage && row.status !== null ? (
            <form action={actions.setSuspended} className="admin-head-actions">
              <input type="hidden" name="tenant_id" value={detail.tenantId} />
              <input type="hidden" name="suspend" value={suspended ? '0' : '1'} />
              <SubmitButton data-role={suspended ? 'resume-subscriber' : 'suspend-subscriber'}>
                {suspended ? 'إعادة تفعيل المشترك' : 'إيقاف المشترك'}
              </SubmitButton>
            </form>
          ) : undefined
        }
      />

      {view.notice === null ? null : (
        <Notice tone={view.notice.tone} role="subscriber-notice">
          {view.notice.text}
        </Notice>
      )}

      <section className="admin-stats" data-role="subscriber-figures" aria-label="حال المشترك">
        <Card variant="stat" as="article">
          <p className="admin-stat-label">الباقة</p>
          <p className="admin-stat-value admin-stat-value-sm">{planCellAr(row)}</p>
          <p className="admin-stat-line">
            {row.billingModel === 'PAYG'
              ? 'كل عملية بسعر منتجها'
              : `منذ ${row.termStart === null ? '·' : dateAr(row.termStart)}`}
          </p>
        </Card>
        <Card variant="stat" as="article">
          <p className="admin-stat-label">ينتهي في</p>
          <p className="admin-stat-value admin-stat-value-sm">{endsAr(row)}</p>
          <p className="admin-stat-line">
            {row.billingModel === 'PAYG' || row.daysLeft === null
              ? 'بلا مدة'
              : termPhrase(row.daysLeft)}
          </p>
        </Card>
        <Card variant="stat" as="article">
          <p className="admin-stat-label">الرصيد المتبقي</p>
          <p className="admin-stat-value">
            <Ltr>{balanceCellAr(row)}</Ltr>
          </p>
          <p className="admin-stat-line">
            {row.operationsLeft === null ? 'في المحفظة، قبل الضريبة' : 'عملية من الباقة والحزم'}
          </p>
        </Card>
        <Card
          variant="stat"
          as="article"
          tone={row.standing === 'ACTIVE' ? 'surface' : 'attention'}
        >
          <p className="admin-stat-label">الحالة</p>
          <p className="admin-stat-value admin-stat-value-sm">
            <Tag tone={standing.tone} role="subscriber-standing">
              {standing.labelAr}
            </Tag>
          </p>
          <p className="admin-stat-line">
            استهلاك 30 يوماً: <Ltr>{count(row.runs30)}</Ltr>
          </p>
        </Card>
      </section>

      <div className="admin-detail-grid">
        <Card role="subscriber-plan" labelledBy="subscriber-plan-title">
          <h2 className="card-title admin-offer-title" id="subscriber-plan-title">
            الباقة
          </h2>
          {view.canManage ? (
            <form action={actions.assignPlan} className="admin-dialog-form">
              <input type="hidden" name="tenant_id" value={detail.tenantId} />
              <Field
                id="assign-plan"
                label="نقل إلى باقة"
                hint="من الآن، بما تمنحه الباقة من عمليات ومدة. الرصيد والحزم تبقى كما هي."
              >
                {(control) => (
                  <Select
                    {...control}
                    name="package_code"
                    defaultValue={detail.packageCode ?? ''}
                    required
                  >
                    <option value="" disabled>
                      اختر باقة
                    </option>
                    {view.plans.map((plan) => (
                      <option key={plan.code} value={plan.code}>
                        {plan.nameAr}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <SubmitButton pendingLabel="جارٍ النقل" data-role="assign-plan">
                نقل إلى الباقة
              </SubmitButton>
            </form>
          ) : (
            <p className="admin-card-note">{detail.packageNameAr ?? 'بلا باقة'}</p>
          )}
        </Card>

        <Card role="subscriber-special" labelledBy="subscriber-special-title">
          <h2 className="card-title admin-offer-title" id="subscriber-special-title">
            الأسعار الخاصة
          </h2>
          <p className="admin-card-note">
            {view.specialPrice === null
              ? 'لا سعر خاص لهذا المشترك. تُضاف الأسعار الخاصة من «الأسعار والمنتجات».'
              : specialLineAr(view.specialPrice)}
          </p>
          <Link href="/operator/pricing" className="admin-row-link">
            الأسعار والمنتجات
          </Link>
        </Card>
      </div>

      <Card variant="flush" role="subscriber-bundles" labelledBy="subscriber-bundles-title">
        <div className="admin-card-head">
          <h2 className="card-title admin-card-title" id="subscriber-bundles-title">
            الحزم
          </h2>
        </div>
        {detail.bundles.length === 0 ? (
          <p className="admin-empty">لم يشترِ هذا المشترك حزمة بعد.</p>
        ) : (
          <div className="admin-table">
            <Table label="الحزم">
              <thead>
                <tr>
                  <Th>الحزمة</Th>
                  <Th>المتبقي</Th>
                  <Th>مُنحت في</Th>
                  <Th>تنتهي في</Th>
                </tr>
              </thead>
              <tbody>
                {detail.bundles.map((bundle) => (
                  <tr key={`${bundle.bundleCode}-${bundle.grantedAt.toISOString()}`}>
                    <td>{bundleLabelOf(bundle.bundleCode)}</td>
                    <td>
                      <Ltr>
                        {count(bundle.operations - bundle.used)} / {count(bundle.operations)}
                      </Ltr>
                    </td>
                    <td>{dateAr(bundle.grantedAt)}</td>
                    <td>{dateAr(bundle.expiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <Card variant="flush" role="subscriber-usage" labelledBy="subscriber-usage-title">
        <div className="admin-card-head">
          <h2 className="card-title admin-card-title" id="subscriber-usage-title">
            الاستهلاك في هذه المدة
          </h2>
          <p className="admin-card-note">بحسب منتج التحقق، والمبالغ قبل الضريبة</p>
        </div>
        {detail.usage.length === 0 ? (
          <p className="admin-empty">لم يشغّل هذا المشترك أي عملية تحقق في هذه المدة.</p>
        ) : (
          <div className="admin-table">
            <Table label="الاستهلاك في هذه المدة">
              <thead>
                <tr>
                  <Th>المنتج</Th>
                  <Th>العمليات</Th>
                  <Th>منها من الباقة</Th>
                  <Th>الإيراد</Th>
                  <Th>التكلفة</Th>
                </tr>
              </thead>
              <tbody>
                {detail.usage.map((line) => (
                  <tr key={line.productCode}>
                    <td>{line.productNameAr}</td>
                    <td>
                      <Ltr>{count(line.runs)}</Ltr>
                    </td>
                    <td>
                      <Ltr>{count(line.packageRuns)}</Ltr>
                    </td>
                    <td>
                      <Ltr>{riyals(line.billedHalalas)}</Ltr>
                    </td>
                    <td>
                      <Ltr>{riyals(line.costHalalas)}</Ltr>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <Card variant="flush" role="subscriber-topups" labelledBy="subscriber-topups-title">
        <div className="admin-card-head">
          <h2 className="card-title admin-card-title" id="subscriber-topups-title">
            طلبات الشحن
          </h2>
          <p className="admin-card-note">آخر 20 طلباً</p>
        </div>
        {detail.topUps.length === 0 ? (
          <p className="admin-empty">لم يطلب هذا المشترك شحن رصيد ولا حزمة بعد.</p>
        ) : (
          <div className="admin-table">
            <Table label="طلبات الشحن">
              <thead>
                <tr>
                  <Th>المرجع</Th>
                  <Th>المبلغ قبل الضريبة</Th>
                  <Th>يشتري</Th>
                  <Th>الحالة</Th>
                  <Th>تاريخ الطلب</Th>
                </tr>
              </thead>
              <tbody>
                {detail.topUps.map((topUp) => (
                  <tr key={topUp.reference}>
                    <td>
                      <Ltr>{topUp.reference}</Ltr>
                    </td>
                    <td>
                      <Ltr>{riyals(topUp.amountHalalas)}</Ltr>
                    </td>
                    <td>{bundleLabelOf(topUp.bundleCode) ?? 'رصيد بالريال'}</td>
                    <td>{TOPUP_STATUS[topUp.status] ?? topUp.status}</td>
                    <td>{dateAr(topUp.requestedAt)}</td>
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
