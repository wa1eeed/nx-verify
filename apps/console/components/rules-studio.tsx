import type { ReactElement } from 'react';

/**
 * The decision rules, and what changing them would do.
 *
 * docs/01-blueprint.md section 6.2 asks for a simulation over historical data before a
 * rule set is switched on, and that is the whole point of this screen. Changing a rule
 * blind is how a compliance team discovers on Monday that four hundred customers moved
 * into review.
 *
 * Rules are shown in evaluation order with the first match highlighted as the decisive
 * one, because that is how they actually work and a screen that hides it invites people
 * to write rules that never fire.
 */

export interface RuleRowView {
  seq: number;
  description: string;
  outcome: 'PASS' | 'FAIL' | 'REVIEW';
  reasonAr: string;
}

export interface SimulationView {
  entitiesEvaluated: number;
  outcomes: { PASS: number; FAIL: number; REVIEW: number };
  changed: number;
}

export interface RulesStudioProps {
  rulesetName: string;
  isDefault: boolean;
  rules: RuleRowView[];
  simulation?: SimulationView | undefined;
}

const OUTCOME_LABELS: Record<RuleRowView['outcome'], string> = {
  PASS: 'مقبول',
  FAIL: 'مرفوض',
  REVIEW: 'مراجعة',
};

export function describeCondition(condition: Record<string, unknown>): string {
  const op = String(condition['op'] ?? '');
  const field = condition['field'] === undefined ? '' : String(condition['field']);
  const value = condition['value'];

  switch (op) {
    case 'always':
      return 'في كل الحالات الأخرى';
    case 'missing':
      return `${field} غير متوفر أو منتهي الصلاحية`;
    case 'present':
      return `${field} متوفر وحديث`;
    case 'stale':
      return `${field} قديم ويحتاج إعادة تحقق`;
    case 'eq':
      return `${field} يساوي ${String(value)}`;
    case 'ne':
      return `${field} لا يساوي ${String(value)}`;
    case 'in':
      return `${field} ضمن ${Array.isArray(value) ? value.join('، ') : ''}`;
    case 'linked_gte':
      return `الطرف مرتبط بـ${String(value)} كيانات أو أكثر`;
    default:
      return op;
  }
}

export function RulesStudio({
  rulesetName,
  isDefault,
  rules,
  simulation,
}: RulesStudioProps): ReactElement {
  return (
    <div className="stack">
      <h1>قواعد القرار</h1>

      <p className="muted">
        {rulesetName}
        {isDefault ? ' · افتراضي النظام، غير قابل للتعديل' : ' · خاصة بهذا المشترك'}
      </p>

      <p className="muted" data-role="order-notice">
        تُقيَّم القواعد بالترتيب، وأول قاعدة تنطبق هي التي تحسم النتيجة. القاعدة التي لا تنطبق قبلها
        لا تُقيَّم أصلاً.
      </p>

      {simulation ? (
        <section className="card stack" data-role="simulation">
          <strong>محاكاة على البيانات القائمة</strong>
          <p>
            على{' '}
            <bdi dir="ltr" className="mono">
              {simulation.entitiesEvaluated}
            </bdi>{' '}
            كياناً: مقبول{' '}
            <bdi dir="ltr" className="mono">
              {simulation.outcomes.PASS}
            </bdi>
            ، مرفوض{' '}
            <bdi dir="ltr" className="mono">
              {simulation.outcomes.FAIL}
            </bdi>
            ، مراجعة{' '}
            <bdi dir="ltr" className="mono">
              {simulation.outcomes.REVIEW}
            </bdi>
            .
          </p>
          <p data-role="changed">
            سيتغيّر قرار{' '}
            <bdi dir="ltr" className="mono">
              {simulation.changed}
            </bdi>{' '}
            كياناً عمّا هو مسجّل الآن.
          </p>
        </section>
      ) : null}

      <section className="card">
        <table>
          <thead>
            <tr>
              <th>الترتيب</th>
              <th>الشرط</th>
              <th>النتيجة</th>
              <th>السبب المعروض</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.seq} data-outcome={rule.outcome}>
                <td>
                  <bdi dir="ltr" className="mono">
                    {rule.seq}
                  </bdi>
                </td>
                <td>{rule.description}</td>
                <td>{OUTCOME_LABELS[rule.outcome]}</td>
                <td className="muted">{rule.reasonAr}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="row">
        <button type="submit" className="btn-primary" disabled={isDefault}>
          حفظ القواعد
        </button>
        <button type="button" className="btn-secondary">
          محاكاة قبل الحفظ
        </button>
      </div>
    </div>
  );
}
