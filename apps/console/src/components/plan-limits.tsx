import type { ReactElement } from 'react';
import { Panel } from './page-header';
import { Table, Th } from './ui/table';
import { Tag } from './ui/tag';
import { Ltr } from './ui/ltr';

/**
 * What the plan grants by the count, and how much of it is gone (ADR-184).
 *
 * A subscriber met these ceilings only as a refusal, because nothing on any screen said a plan
 * sold two API keys or twenty five monitors until the moment somebody was stopped at one. A
 * limit discovered that way is not read as a limit, it is read as the platform being broken.
 *
 * So the figures sit beside the rest of what the plan grants, on «الباقة والرصيد», in the same
 * place the included transactions and the modules are read. The panel says three things and no
 * more: what was bought, what is used, and what that means for the next one.
 *
 * It says one other thing when it has to. The API's per minute ceiling is sold per plan and the
 * platform still applies a single figure to every caller alike, so when the two disagree this
 * panel prints both rather than printing the one that flatters us. A screen that quoted the
 * plan's six hundred while the gateway refused at a hundred and twenty would be the same defect
 * one layer further out.
 */

export interface PlanLimitView {
  /** Null is no ceiling: the enterprise plan's answer, and never zero. */
  limit: number | null;
  used: number;
  remaining: number | null;
  atLimit: boolean;
  /** Above a ceiling acquired later. Nothing is taken away; nothing may be added. */
  over: boolean;
}

export interface PlanLimitsView {
  /** False when no plan stands behind the workspace, and so no ceiling does either. */
  committed: boolean;
  apiKeys: PlanLimitView;
  monitors: PlanLimitView;
  users: PlanLimitView;
  /** Calls a minute the plan sells. */
  rateLimitRpm: number;
  /** Calls a minute the API actually applies today, per key. */
  appliedRateLimitRpm: number;
}

/** The approved wording for each ceiling, decided once rather than per row. */
const COUNTED: { key: keyof Pick<PlanLimitsView, 'apiKeys' | 'monitors' | 'users'>; labelAr: string; unitAr: string }[] = [
  { key: 'apiKeys', labelAr: 'مفاتيح الـAPI', unitAr: 'مفتاح' },
  { key: 'monitors', labelAr: 'المراقبات', unitAr: 'مراقبة' },
  { key: 'users', labelAr: 'المستخدمون', unitAr: 'مستخدم' },
];

/**
 * What this row means for the next one.
 *
 * Amber, never red: none of these is a failure. Being at or above a ceiling is something that
 * deserves a look, which is exactly what the accent tone is for, and red on this platform means
 * something did not work.
 */
export function limitStandingAr(limit: PlanLimitView): string | null {
  if (limit.limit === null) {
    return null;
  }
  if (limit.over) {
    return 'فوق حدّ باقتك · ما هو قائم يبقى، ولا يُضاف جديد';
  }
  if (limit.atLimit) {
    return 'بلغتَ حدّ باقتك · لا يُضاف جديد';
  }
  return null;
}

export function PlanLimits({ view }: { view: PlanLimitsView }): ReactElement {
  const rateDiffers = view.rateLimitRpm !== view.appliedRateLimitRpm;

  return (
    <Panel
      title="حدود باقتك"
      aside="ما تمنحه بالعدد"
      note="الحدّ يمنع الإضافة ولا يُلغي ما هو قائم: مساحة عمل فوق حدّها تحتفظ بكل ما لديها."
      role="plan-limits"
    >
      {view.committed ? null : (
        <p className="faint" data-role="no-commitment">
          لا توجد باقة مفعّلة لمساحة العمل هذه، فلا حدّ بالعدد مطبَّق عليها.
        </p>
      )}

      <Table label="حدود الباقة بالعدد">
        <thead>
          <tr>
            <Th>الحد</Th>
            <Th>ما تمنحه الباقة</Th>
            <Th>المستهلك</Th>
            <Th>المتبقي</Th>
          </tr>
        </thead>
        <tbody>
          {COUNTED.map((row) => {
            const limit = view[row.key];
            const standing = limitStandingAr(limit);
            return (
              <tr key={row.key} data-role={`limit-${row.key}`}>
                <td>{row.labelAr}</td>
                <td>
                  <Ltr>{limit.limit === null ? 'بلا حد' : limit.limit}</Ltr>
                </td>
                <td>
                  <Ltr>{limit.used}</Ltr>
                </td>
                <td>
                  {limit.remaining === null ? (
                    <Ltr>بلا حد</Ltr>
                  ) : (
                    <Ltr>{limit.remaining}</Ltr>
                  )}
                  {standing === null ? null : (
                    <>
                      {' '}
                      <Tag tone="accent" role={`standing-${row.key}`}>
                        {standing}
                      </Tag>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      {/*
        The one ceiling that is sold per plan and not yet applied per plan. Both figures, in the
        order a reader needs them: what was bought, then what the gateway does today.
      */}
      <p data-role="rate-limit">
        نداءات الـAPI: تمنحك باقتك{' '}
        <Ltr>{view.rateLimitRpm}</Ltr> نداءً في الدقيقة لكل مفتاح.
        {rateDiffers ? (
          <>
            {' '}
            <Tag tone="accent" role="rate-limit-applied">
              الحدّ السارِي اليوم <Ltr>{view.appliedRateLimitRpm}</Ltr> في الدقيقة
            </Tag>
          </>
        ) : null}
      </p>
    </Panel>
  );
}
