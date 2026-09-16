import type { ReactElement } from 'react';
import type { RiskCategory } from '@nx-verify/core';
import { Card } from './ui/card';
import { SubmitButton } from './ui/submit-button';
import { Tag } from './ui/tag';

/**
 * The kinds of doubt a score is allowed to be made of (ADR-138).
 *
 * The second axis an owner decides along, beside the verification service. «Stop counting
 * intersections» and «stop counting an unfinished file» are sentences about what a risk score
 * is allowed to mean, and each is one control here rather than three or four rows to find.
 */

export const CATEGORY_LABELS: Readonly<Record<RiskCategory, string>> = {
  STATUS: 'حالة رسمية',
  MISMATCH: 'عدم تطابق',
  INTERSECTION: 'تقاطع',
  INCOMPLETE: 'نقص في الملف',
  CHANGE: 'تغيّر مرصود',
  AGE: 'حداثة',
};

export const CATEGORY_NOTES: Readonly<Record<RiskCategory, string>> = {
  STATUS: 'ما تقوله الجهة عن الحالة: سجل غير فعّال، تصفية، وثيقة غير سارية، حساب غير نشط',
  MISMATCH: 'إجابتان لا تتفقان: اسم لا يطابق صاحب الحساب، وثيقة لا تعود لصاحب الهوية',
  INTERSECTION: 'ما يربط هذا العميل بعملائك الآخرين: حساب مشترك، عنوان مشترك، مدير يدير غيره',
  INCOMPLETE: 'أقسام مطلوبة في الملف لم تُملأ بعد',
  CHANGE: 'تغيّر رُصد على حقل ولم يطّلع عليه أحد',
  AGE: 'حداثة تأسيس المنشأة',
};

/** A number of signals, in the form Arabic gives that number. */
function signalsAr(n: number): string {
  if (n === 1) {
    return 'مؤشر واحد يُحتسب';
  }
  if (n === 2) {
    return 'مؤشران يُحتسبان';
  }
  return n <= 10 ? `${n} مؤشرات تُحتسب` : `${n} مؤشراً يُحتسب`;
}

export interface CategoryState {
  category: RiskCategory;
  signals: number;
  on: number;
  /** True when this subscriber has written an opinion about any signal of this kind. */
  customised?: boolean;
}

export function RiskCategories({
  states,
  canEdit,
  action,
  hiddenFields,
  role,
}: {
  states: readonly CategoryState[];
  canEdit: boolean;
  action: (formData: FormData) => void | Promise<void>;
  /** Fields every form here carries, such as the subscriber it is about. */
  hiddenFields?: Readonly<Record<string, string>>;
  role: string;
}): ReactElement {
  return (
    <Card variant="flush" role={role} labelledBy={`${role}-title`}>
      <div className="admin-card-head">
        <h2 className="card-title admin-card-title" id={`${role}-title`}>
          أنواع الخطر
        </h2>
      </div>
      <p className="admin-card-note">
        كل نوع مجموعة مؤشرات تسأل السؤال نفسه. إيقاف النوع يوقف مؤشراته كلها، فلا تُحتسب ولا تظهر في
        أسباب الدرجة.
      </p>
      <div className="admin-table">
        {states.map((state) => {
          const allOn = state.on === state.signals;
          const allOff = state.on === 0;
          return (
            <div
              key={state.category}
              className="admin-card-head"
              data-role="risk-category"
              data-item={state.category}
            >
              <div>
                <span className="admin-offer-title">{CATEGORY_LABELS[state.category]}</span>
                <span className="admin-offer-terms"> · {CATEGORY_NOTES[state.category]}</span>
              </div>
              <div className="admin-head-actions">
                <Tag tone={allOff ? 'critical' : allOn ? 'accent-2' : 'accent'}>
                  {allOff
                    ? 'موقوف'
                    : allOn
                      ? signalsAr(state.signals)
                      : `${state.on} من ${state.signals} تُحتسب`}
                </Tag>
                {state.customised === true ? <Tag tone="accent">مخصّص</Tag> : null}
                {canEdit ? (
                  <form action={action} className="inline">
                    {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
                      <input key={name} type="hidden" name={name} value={value} />
                    ))}
                    <input type="hidden" name="category" value={state.category} />
                    <input type="hidden" name="enabled" value={allOff ? 'true' : 'false'} />
                    <SubmitButton
                      variant={allOff ? 'primary' : 'secondary'}
                      data-role="set-category-risk"
                      pendingLabel="جارٍ الحفظ"
                    >
                      {allOff ? 'استئناف هذا النوع' : 'إيقاف هذا النوع'}
                    </SubmitButton>
                  </form>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
