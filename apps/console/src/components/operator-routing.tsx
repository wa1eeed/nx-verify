import type { ReactElement } from 'react';
import { Card } from './ui/card';
import { Ltr } from './ui/ltr';
import { Notice } from './ui/notice';
import { Table, Th } from './ui/table';
import { Tag } from './ui/tag';
import { SubmitButton } from './ui/submit-button';
import { Select } from './ui/select';
import { PageHeader } from './page-header';
import { dateAr, riyals, timeOfDay } from './format';

/**
 * Which provider serves each verification service, and what it costs us to be served by them
 * (ADR-135).
 *
 * The screen answers three questions in one table, because an owner switching a provider asks
 * all three at once: who serves this today, what would each provider cost me, and did the calls
 * actually move after I switched.
 *
 * The third is the one that cannot be answered by a settings page. It is read from a counter
 * written as each call is placed, so it is what happened rather than what was configured.
 */

export interface RoutingOfferView {
  provider: string;
  nameAr: string;
  costHalalas: number | null;
  serves: boolean;
  routed: boolean;
  priority: number | null;
  status: 'active' | 'standby' | null;
  health: string;
}

export interface RoutingServedView {
  provider: string;
  calls: number;
  failed: number;
  lastCallAt: Date | null;
}

export interface RoutingServiceView {
  productCode: string;
  nameAr: string;
  servedBy: string | null;
  priceHalalas: number | null;
  costHalalas: number | null;
  marginPct: number | null;
  offers: RoutingOfferView[];
  served: RoutingServedView[];
}

export interface RoutingView {
  services: RoutingServiceView[];
  notice: { tone: 'done' | 'refused'; text: string } | null;
  now: Date;
}

const HEALTH_LABELS: Record<string, string> = {
  healthy: 'يجيب',
  degraded: 'بطيء',
  down: 'لا يجيب',
  unknown: 'لم يُختبر',
};

function marginTone(margin: number | null): 'accent-2' | 'accent' | 'critical' | 'neutral' {
  if (margin === null) {
    return 'neutral';
  }
  return margin >= 40 ? 'accent-2' : margin >= 15 ? 'accent' : 'critical';
}

export function OperatorRouting({
  view,
  setRouteAction,
  removeRouteAction,
}: {
  view: RoutingView;
  setRouteAction: (formData: FormData) => void | Promise<void>;
  removeRouteAction: (formData: FormData) => void | Promise<void>;
}): ReactElement {
  return (
    <div className="admin-screen" data-role="operator-routing">
      <PageHeader
        title="المزودون والخدمات"
        subtitle="من يخدم كل خدمة تحقق، وكم تكلفنا عند كل مزوّد، وكم من النداءات ذهبت إليه فعلاً هذا الشهر."
      />

      {view.notice === null ? null : (
        <Notice tone={view.notice.tone} role="routing-notice">
          {view.notice.text}
        </Notice>
      )}

      {view.services.map((service) => (
        <Card
          key={service.productCode}
          variant="flush"
          role="routing-service"
          labelledBy={`service-${service.productCode}`}
        >
          <div className="admin-card-head">
            <h2 className="card-title admin-card-title" id={`service-${service.productCode}`}>
              {service.nameAr}
            </h2>
            <div className="admin-head-actions">
              <Tag tone="neutral">
                <Ltr>{service.productCode}</Ltr>
              </Tag>
              {service.servedBy === null ? (
                <Tag tone="neutral">يخدمها ما يعلنه المنتج</Tag>
              ) : (
                <Tag tone="accent-2">
                  يخدمها الآن:{' '}
                  {service.offers.find((offer) => offer.provider === service.servedBy)?.nameAr ??
                    service.servedBy}
                </Tag>
              )}
              <Tag tone={marginTone(service.marginPct)}>
                {service.marginPct === null ? 'الهامش غير معروف' : `الهامش ${service.marginPct}%`}
              </Tag>
            </div>
          </div>

          <p className="admin-card-note">
            سعرنا{' '}
            {service.priceHalalas === null ? (
              'غير محدّد'
            ) : (
              <Ltr>{riyals(service.priceHalalas)}</Ltr>
            )}
            {' · '}
            تكلفتها عند المزوّد الذي يخدمها{' '}
            {service.costHalalas === null ? 'غير معروفة' : <Ltr>{riyals(service.costHalalas)}</Ltr>}
          </p>

          <div className="admin-table">
            <Table label={`مزودو ${service.nameAr}`}>
              <thead>
                <tr>
                  <Th>المزوّد</Th>
                  <Th>تكلفة العملية</Th>
                  <Th>الهامش عنده</Th>
                  <Th>حالته</Th>
                  <Th>الترتيب</Th>
                  <Th>
                    <span className="visually-hidden">إجراء</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {service.offers.map((offer) => {
                  const margin =
                    service.priceHalalas === null ||
                    service.priceHalalas <= 0 ||
                    offer.costHalalas === null
                      ? null
                      : Math.round(
                          ((service.priceHalalas - offer.costHalalas) / service.priceHalalas) * 100,
                        );
                  return (
                    <tr key={offer.provider} data-role="routing-offer">
                      <td>
                        {offer.nameAr}
                        {offer.provider === service.servedBy ? (
                          <span className="admin-offer-terms"> · يخدمها</span>
                        ) : null}
                      </td>
                      <td>
                        {offer.costHalalas === null ? (
                          <span className="muted">لا يخدم هذه الخدمة</span>
                        ) : (
                          <Ltr>{riyals(offer.costHalalas)}</Ltr>
                        )}
                      </td>
                      <td>
                        {margin === null ? (
                          <span className="muted">·</span>
                        ) : (
                          <Tag tone={marginTone(margin)}>{margin}%</Tag>
                        )}
                      </td>
                      <td>{HEALTH_LABELS[offer.health] ?? offer.health}</td>
                      <td>
                        {offer.routed ? (
                          <Ltr>{String(offer.priority ?? '')}</Ltr>
                        ) : (
                          <span className="muted">غير معيّن</span>
                        )}
                        {offer.status === 'standby' ? (
                          <span className="admin-offer-terms"> · احتياط</span>
                        ) : null}
                      </td>
                      <td>
                        <form action={setRouteAction} className="row admin-inline-form">
                          <input type="hidden" name="product_code" value={service.productCode} />
                          <input type="hidden" name="provider" value={offer.provider} />
                          <Select
                            name="status"
                            defaultValue={offer.status ?? 'active'}
                            aria-label="الحالة"
                          >
                            <option value="active">يخدم</option>
                            <option value="standby">احتياط</option>
                          </Select>
                          <Select
                            name="priority"
                            defaultValue={String(offer.priority ?? 1)}
                            aria-label="الترتيب"
                          >
                            <option value="1">أولاً</option>
                            <option value="2">ثانياً</option>
                            <option value="3">ثالثاً</option>
                          </Select>
                          <SubmitButton
                            variant={offer.provider === service.servedBy ? 'secondary' : 'primary'}
                            data-role="set-route"
                            pendingLabel="جارٍ الحفظ"
                          >
                            {offer.routed ? 'تحديث' : 'تعيين'}
                          </SubmitButton>
                        </form>
                        {offer.routed ? (
                          <form action={removeRouteAction} className="inline">
                            <input type="hidden" name="product_code" value={service.productCode} />
                            <input type="hidden" name="provider" value={offer.provider} />
                            <SubmitButton variant="ghost" data-role="remove-route">
                              إزالة
                            </SubmitButton>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>

          <div className="admin-table">
            <p className="admin-card-note" data-role="served-note">
              ما حدث فعلاً هذا الشهر والذي قبله. هذا عدّاد يُكتب مع كل نداء، لا إعداد:
            </p>
            {service.served.length === 0 ? (
              <p className="admin-empty" data-role="empty-state">
                لم تُنفَّذ عملية واحدة من هذه الخدمة بعد.
              </p>
            ) : (
              <Table label={`نداءات ${service.nameAr}`}>
                <thead>
                  <tr>
                    <Th>المزوّد</Th>
                    <Th>نداءات</Th>
                    <Th>فشل</Th>
                    <Th>آخر نداء</Th>
                  </tr>
                </thead>
                <tbody>
                  {service.served.map((row) => (
                    <tr key={row.provider} data-role="served-row">
                      <td>
                        {service.offers.find((offer) => offer.provider === row.provider)?.nameAr ??
                          row.provider}
                      </td>
                      <td>
                        <Ltr>{String(row.calls)}</Ltr>
                      </td>
                      <td>
                        {row.failed === 0 ? (
                          <span className="muted">لا شيء</span>
                        ) : (
                          <Tag tone="critical">
                            <Ltr>{String(row.failed)}</Ltr>
                          </Tag>
                        )}
                      </td>
                      <td>
                        {row.lastCallAt === null ? (
                          <span className="muted">·</span>
                        ) : (
                          <>
                            {dateAr(row.lastCallAt)}، <Ltr>{timeOfDay(row.lastCallAt)}</Ltr>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
