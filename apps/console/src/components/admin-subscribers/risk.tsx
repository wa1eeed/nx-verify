import type { ReactElement } from 'react';
import type { TenantRiskModel } from '@nx-verify/core';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Ltr } from '../ui/ltr';
import { Select } from '../ui/select';
import { SubmitButton } from '../ui/submit-button';
import { Table, Th } from '../ui/table';
import { Tag } from '../ui/tag';
import { CATEGORY_LABELS, RiskCategories, type CategoryState } from '../risk-categories';

/**
 * One subscriber's risk model, and which parts of it are theirs (ADR-138).
 *
 * The platform's model is the baseline and this screen shows what they believe instead, field
 * by field. A field they have no opinion about keeps inheriting: it is not copied here when
 * they are created, so improving a default still reaches them, and a year from now «they chose
 * five» is still distinguishable from «five was the default that March».
 *
 * A subscriber never sees these controls. Somebody who sets their own risk thresholds is
 * marking their own examination, so the model is staff's to set and theirs to read.
 */

export function SubscriberRisk({
  tenantId,
  model,
  canManage,
  setSignal,
  setBands,
  setCategory,
}: {
  tenantId: string;
  model: TenantRiskModel;
  canManage: boolean;
  setSignal: (formData: FormData) => void | Promise<void>;
  setBands: (formData: FormData) => void | Promise<void>;
  setCategory: (formData: FormData) => void | Promise<void>;
}): ReactElement {
  const own = model.signals.filter((signal) => signal.source === 'subscriber').length;
  const states = new Map<CategoryState['category'], CategoryState>();
  for (const signal of model.signals) {
    const state = states.get(signal.category) ?? {
      category: signal.category,
      signals: 0,
      on: 0,
      customised: false,
    };
    state.signals += 1;
    state.on += signal.effectiveEnabled ? 1 : 0;
    state.customised = state.customised === true || signal.source === 'subscriber';
    states.set(signal.category, state);
  }
  const categories = [...states.values()];

  return (
    <Card variant="flush" role="subscriber-risk" labelledBy="subscriber-risk-title">
      <div className="admin-card-head">
        <h2 className="card-title admin-card-title" id="subscriber-risk-title">
          مؤشرات المخاطر
        </h2>
        <div className="admin-head-actions">
          <Tag tone={own === 0 ? 'neutral' : 'accent'}>
            {own === 0 ? 'يرث نموذج المنصة كاملاً' : `مخصّص له ${own} من ${model.signals.length}`}
          </Tag>
          <Tag tone={model.bandsSource === 'platform' ? 'neutral' : 'accent'}>
            {`عالية من ${model.bands.highFrom} · متوسطة من ${model.bands.mediumFrom}`}
          </Tag>
        </div>
      </div>

      <p className="admin-card-note">
        ما لم يُخصَّص لهذا المشترك يبقى موروثاً من نموذج المنصة، فيصله أي تحسين لاحق عليه. ولا تظهر
        هذه الإعدادات في كونسول المشترك: من يُقاس لا يضبط مسطرته.
      </p>

      {canManage ? (
        <form action={setBands} className="row admin-inline-form" data-role="subscriber-bands">
          <input type="hidden" name="tenant_id" value={tenantId} />
          <span className="admin-price-field">
            <Input
              name="high_from"
              inputMode="numeric"
              defaultValue={model.bands.highFrom}
              aria-label="تُقرأ «عالية» من"
              ltr
            />
          </span>
          <span className="admin-price-field">
            <Input
              name="medium_from"
              inputMode="numeric"
              defaultValue={model.bands.mediumFrom}
              aria-label="وتُقرأ «متوسطة» من"
              ltr
            />
          </span>
          <SubmitButton variant="secondary" data-role="set-tenant-bands" pendingLabel="جارٍ الحفظ">
            حدود خاصة
          </SubmitButton>
          {model.bandsSource === 'platform' ? null : (
            <SubmitButton name="clear" value="1" variant="ghost" data-role="clear-tenant-bands">
              {`رفع التخصيص (المنصة: ${model.platformBands.mediumFrom}–${model.platformBands.highFrom})`}
            </SubmitButton>
          )}
        </form>
      ) : null}

      <RiskCategories
        states={categories}
        canEdit={canManage}
        action={setCategory}
        hiddenFields={{ tenant_id: tenantId }}
        role="subscriber-risk-categories"
      />

      <div className="admin-table">
        <Table label="مؤشرات مخاطر هذا المشترك">
          <thead>
            <tr>
              <Th>المؤشر</Th>
              <Th>الوزن عنده</Th>
              <Th>العتبة عنده</Th>
              <Th>المصدر</Th>
              <Th>
                <span className="visually-hidden">إجراء</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {model.signals.map((signal) => (
              <tr key={signal.code} data-role="subscriber-signal" data-signal={signal.code}>
                <td>
                  <span className="admin-offer-title">{signal.nameAr}</span>
                  <span className="admin-offer-terms">
                    {' · '}
                    {CATEGORY_LABELS[signal.category]}
                  </span>
                </td>
                <td>
                  {signal.effectiveEnabled ? (
                    <Ltr>{`+${signal.effectiveWeight}`}</Ltr>
                  ) : (
                    <span className="muted">موقوف</span>
                  )}
                  {signal.effectiveWeight === signal.weight ? null : (
                    <span className="admin-offer-terms">{` · المنصة ${signal.weight}`}</span>
                  )}
                </td>
                <td>
                  {signal.effectiveThreshold === null ? (
                    <span className="muted">·</span>
                  ) : (
                    <Ltr>{String(signal.effectiveThreshold)}</Ltr>
                  )}
                </td>
                <td>
                  <Tag tone={signal.source === 'platform' ? 'neutral' : 'accent'}>
                    {signal.source === 'platform' ? 'موروث' : 'مخصّص'}
                  </Tag>
                </td>
                <td>
                  {canManage ? (
                    <form action={setSignal} className="row admin-inline-form">
                      <input type="hidden" name="tenant_id" value={tenantId} />
                      <input type="hidden" name="code" value={signal.code} />
                      <span className="admin-price-field">
                        <Input
                          name="weight"
                          inputMode="numeric"
                          defaultValue={signal.effectiveWeight}
                          aria-label={`وزن ${signal.nameAr} لهذا المشترك`}
                          ltr
                        />
                      </span>
                      {signal.effectiveThreshold === null ? null : (
                        <span className="admin-price-field">
                          <Input
                            name="threshold"
                            inputMode="numeric"
                            defaultValue={signal.effectiveThreshold}
                            aria-label={signal.thresholdLabelAr ?? 'العتبة'}
                            ltr
                          />
                        </span>
                      )}
                      <Select
                        name="enabled"
                        defaultValue={signal.effectiveEnabled ? 'true' : 'false'}
                        aria-label={`حالة ${signal.nameAr}`}
                      >
                        <option value="true">يُحتسب</option>
                        <option value="false">موقوف</option>
                      </Select>
                      <SubmitButton
                        variant="secondary"
                        data-role="set-tenant-signal"
                        pendingLabel="جارٍ الحفظ"
                      >
                        تخصيص
                      </SubmitButton>
                      {signal.source === 'platform' ? null : (
                        <SubmitButton
                          name="clear"
                          value="1"
                          variant="ghost"
                          data-role="clear-tenant-signal"
                        >
                          رفع التخصيص
                        </SubmitButton>
                      )}
                    </form>
                  ) : (
                    <span className="muted">·</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Card>
  );
}
