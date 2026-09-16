import type { ReactElement } from 'react';
import type { RiskCategory, RiskModel, RiskSeverity, RiskSignalRow } from '@nx-verify/core';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Ltr } from './ui/ltr';
import { Notice } from './ui/notice';
import { Select } from './ui/select';
import { SubmitButton } from './ui/submit-button';
import { Table, Th } from './ui/table';
import { Tag } from './ui/tag';
import { PageHeader } from './page-header';

/**
 * The risk model, set from the panel (ADR-138).
 *
 * Everything a score is made of, on one screen and in one vocabulary: what each signal is
 * worth, what number its condition compares against, and whether it is counted at all. The
 * signals are grouped by the verification service whose answers they read, because that is the
 * unit an owner decides about: «stop letting the bank check move the score» is one sentence
 * and one control, not three.
 *
 * Nothing here is a black box on purpose. A compliance officer shown «عالية» is shown the
 * lines that made it high, each with its weight, and this screen is where those weights come
 * from. A model a reader cannot inspect is a verdict nobody can defend to an auditor.
 */

export const CATEGORY_LABELS: Readonly<Record<RiskCategory, string>> = {
  STATUS: 'حالة رسمية',
  MISMATCH: 'عدم تطابق',
  INTERSECTION: 'تقاطع',
  INCOMPLETE: 'نقص في الملف',
  CHANGE: 'تغيّر مرصود',
  AGE: 'حداثة',
};

const SEVERITY_TONES: Readonly<Record<RiskSeverity, 'critical' | 'accent' | 'neutral'>> = {
  HIGH: 'critical',
  MEDIUM: 'accent',
  LOW: 'neutral',
};

const SEVERITY_LABELS: Readonly<Record<RiskSeverity, string>> = {
  HIGH: 'خطير',
  MEDIUM: 'يستحق النظر',
  LOW: 'للعلم',
};

export interface RiskView {
  model: RiskModel;
  canEdit: boolean;
  notice: { tone: 'done' | 'refused'; text: string } | null;
}

/** The signals of one verification service, or the ones that read none. */
interface RiskGroup {
  productCode: string | null;
  titleAr: string;
  signals: RiskSignalRow[];
}

function groupsOf(signals: readonly RiskSignalRow[]): RiskGroup[] {
  const groups = new Map<string, RiskGroup>();
  for (const signal of signals) {
    const key = signal.productCode ?? '';
    const group = groups.get(key) ?? {
      productCode: signal.productCode,
      titleAr: signal.productNameAr ?? 'لا تتبع خدمة بعينها',
      signals: [],
    };
    group.signals.push(signal);
    groups.set(key, group);
  }
  // The services first, then the signals that read no single one: a gap in the file and an
  // unread change are about the file itself rather than about any one verification.
  return [...groups.values()].sort((left, right) =>
    left.productCode === null ? 1 : right.productCode === null ? -1 : 0,
  );
}

export function OperatorRisk({
  view,
  setSignalAction,
  setBandsAction,
  setProductAction,
}: {
  view: RiskView;
  setSignalAction: (formData: FormData) => void | Promise<void>;
  setBandsAction: (formData: FormData) => void | Promise<void>;
  setProductAction: (formData: FormData) => void | Promise<void>;
}): ReactElement {
  const { model, canEdit } = view;
  const groups = groupsOf(model.signals);
  const off = model.signals.filter((signal) => !signal.enabled).length;

  return (
    <div className="admin-screen" data-role="operator-risk">
      <PageHeader
        title="مؤشرات المخاطر"
        subtitle="ما يرفع درجة مخاطر العميل، وبكم، ومتى. الدرجة تُشرح دائماً بأسبابها، وهذه الشاشة مصدر تلك الأسباب."
      />

      {view.notice === null ? null : (
        <Notice tone={view.notice.tone} role="risk-notice">
          {view.notice.text}
        </Notice>
      )}

      <section className="grid" data-role="risk-tiles">
        <article className="stat">
          <span className="stat-label">مؤشرات</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {model.signals.length}
            </bdi>
          </strong>
          <span className="stat-hint">كل مؤشر سطر في شرح الدرجة، لا رقم في صندوق مغلق</span>
        </article>
        <article className="stat" {...(off > 0 ? { 'data-tone': 'changed' } : {})}>
          <span className="stat-label">موقوفة</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {off}
            </bdi>
          </strong>
          <span className="stat-hint">لا تُحتسب ولا تظهر في أسباب الدرجة</span>
        </article>
        <article className="stat">
          <span className="stat-label">النطاق</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {`${model.bands.mediumFrom}–${model.bands.highFrom}`}
            </bdi>
          </strong>
          <span className="stat-hint">متوسطة من الأول، وعالية من الثاني</span>
        </article>
      </section>

      <Card role="risk-bands" labelledBy="risk-bands-title">
        <h2 className="card-title admin-card-title" id="risk-bands-title">
          حدود الدرجة
        </h2>
        <p className="admin-card-note">
          الدرجة رقم من مئة. تقرأ «عالية» من الحد الأول فأعلى، و«متوسطة» من الثاني، وما دونه
          «منخفضة». تغييرها لا يغيّر الدرجة نفسها، بل الكلمة التي تصفها.
        </p>
        {canEdit ? (
          <form action={setBandsAction} className="row admin-inline-form">
            <label className="field-inline" htmlFor="risk-high">
              <span>عالية من</span>
              <Input
                id="risk-high"
                name="high_from"
                type="number"
                min={1}
                max={100}
                defaultValue={model.bands.highFrom}
                ltr
                required
              />
            </label>
            <label className="field-inline" htmlFor="risk-medium">
              <span>متوسطة من</span>
              <Input
                id="risk-medium"
                name="medium_from"
                type="number"
                min={1}
                max={100}
                defaultValue={model.bands.mediumFrom}
                ltr
                required
              />
            </label>
            <SubmitButton data-role="set-bands" pendingLabel="جارٍ الحفظ">
              حفظ الحدود
            </SubmitButton>
          </form>
        ) : (
          <p className="admin-card-note">
            <Ltr>{`${model.bands.mediumFrom} – ${model.bands.highFrom}`}</Ltr>
          </p>
        )}
      </Card>

      {groups.map((group) => {
        const anyOn = group.signals.some((signal) => signal.enabled);
        return (
          <Card
            key={group.productCode ?? 'none'}
            variant="flush"
            role="risk-group"
            labelledBy={`risk-group-${group.productCode ?? 'none'}`}
            data-product={group.productCode ?? ''}
          >
            <div className="admin-card-head">
              <h2
                className="card-title admin-card-title"
                id={`risk-group-${group.productCode ?? 'none'}`}
              >
                {group.titleAr}
              </h2>
              <div className="admin-head-actions">
                {group.productCode === null ? null : (
                  <Tag tone="neutral">
                    <Ltr>{group.productCode}</Ltr>
                  </Tag>
                )}
                {anyOn ? null : <Tag tone="critical">لا يُحتسب منها شيء</Tag>}
                {canEdit && group.productCode !== null ? (
                  <form action={setProductAction} className="inline">
                    <input type="hidden" name="product_code" value={group.productCode} />
                    <input type="hidden" name="enabled" value={anyOn ? 'false' : 'true'} />
                    <SubmitButton
                      variant={anyOn ? 'secondary' : 'primary'}
                      data-role="set-product-risk"
                      pendingLabel="جارٍ الحفظ"
                    >
                      {anyOn ? 'إيقاف احتساب الخطر لهذه الخدمة' : 'استئناف احتساب الخطر'}
                    </SubmitButton>
                  </form>
                ) : null}
              </div>
            </div>

            <div className="admin-table">
              <Table label={`مؤشرات ${group.titleAr}`}>
                <thead>
                  <tr>
                    <Th>المؤشر</Th>
                    <Th>نوعه</Th>
                    <Th>الوزن</Th>
                    <Th>العتبة</Th>
                    <Th>
                      <span className="visually-hidden">إجراء</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {group.signals.map((signal) => (
                    <tr key={signal.code} data-role="risk-signal" data-signal={signal.code}>
                      <td>
                        <span className="admin-offer-title">{signal.nameAr}</span>
                        <span className="admin-offer-terms">
                          {' · '}
                          <Ltr>{signal.code}</Ltr>
                        </span>
                        {signal.overrides === 0 ? null : (
                          <span className="admin-offer-terms">
                            {` · خالفه ${signal.overrides} من المشتركين`}
                          </span>
                        )}
                      </td>
                      <td>
                        <Tag tone={SEVERITY_TONES[signal.severity]}>
                          {CATEGORY_LABELS[signal.category]}
                        </Tag>
                        <span className="admin-offer-terms">
                          {' · '}
                          {SEVERITY_LABELS[signal.severity]}
                        </span>
                      </td>
                      <td>
                        {signal.enabled ? (
                          <Ltr>{`+${signal.weight}`}</Ltr>
                        ) : (
                          <span className="muted">موقوف</span>
                        )}
                      </td>
                      <td>
                        {signal.threshold === null ? (
                          <span className="muted">·</span>
                        ) : (
                          <>
                            <Ltr>{String(signal.threshold)}</Ltr>
                            <span className="admin-offer-terms"> · {signal.thresholdLabelAr}</span>
                          </>
                        )}
                      </td>
                      <td>
                        {canEdit ? (
                          <form action={setSignalAction} className="row admin-inline-form">
                            <input type="hidden" name="code" value={signal.code} />
                            <Input
                              name="weight"
                              type="number"
                              min={0}
                              max={100}
                              defaultValue={signal.weight}
                              aria-label={`وزن ${signal.nameAr}`}
                              ltr
                            />
                            {signal.threshold === null ? null : (
                              <Input
                                name="threshold"
                                type="number"
                                min={0}
                                step="any"
                                defaultValue={signal.threshold}
                                aria-label={signal.thresholdLabelAr ?? 'العتبة'}
                                ltr
                              />
                            )}
                            <Select
                              name="enabled"
                              defaultValue={signal.enabled ? 'true' : 'false'}
                              aria-label={`حالة ${signal.nameAr}`}
                            >
                              <option value="true">يُحتسب</option>
                              <option value="false">موقوف</option>
                            </Select>
                            <SubmitButton
                              variant="secondary"
                              data-role="set-signal"
                              pendingLabel="جارٍ الحفظ"
                            >
                              حفظ
                            </SubmitButton>
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
      })}
    </div>
  );
}
