import Link from 'next/link';
import type { ReactElement } from 'react';
import { PageHeader, Panel } from './page-header';
import { SubmitButton } from './ui/submit-button';

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
 *
 * Both buttons used to be dead, and unlike the rest of this sweep there was nothing in the
 * domain behind them: no code anywhere could write a ruleset, so every workspace ran on
 * whatever the seed put in the database, permanently (ADR-149).
 *
 * The platform's defaults are not editable here and should not be: every workspace inherits
 * them. What this screen offers is to take a copy and move an outcome on the copy, which is
 * the question people actually ask. Changing what a rule *looks at* is a different act, and
 * is not something to offer from a dropdown: conditions are a closed set, and building one is
 * a rule builder.
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

export interface RulesetChoice {
  id: string;
  nameAr: string;
  isDefault: boolean;
}

const OUTCOMES: Record<string, { tone: 'done' | 'refused'; text: string }> = {
  forked: { tone: 'done', text: 'أُنشئت نسخة خاصة بك. عدّل نتائجها ثم حاكِ قبل الاعتماد.' },
  saved: { tone: 'done', text: 'حُفظت القاعدة.' },
  invalid: { tone: 'refused', text: 'الرمز حروف وأرقام من حرفين إلى أربعين، والاسم إلزامي.' },
  exists: { tone: 'refused', text: 'يوجد مجموعة قواعد بالرمز نفسه.' },
  default: {
    tone: 'refused',
    text: 'قواعد المنصة الافتراضية لا تُعدَّل: يرثها كل مشترك. انسخها إلى مجموعة خاصة بك أولاً.',
  },
  failed: { tone: 'refused', text: 'لم يُحفظ التغيير. حاول مرة أخرى.' },
};

export function rulesNotice(
  outcome: string | undefined,
): { tone: 'done' | 'refused'; text: string } | null {
  return outcome === undefined ? null : (OUTCOMES[outcome] ?? null);
}

type Action = (formData: FormData) => void | Promise<void>;

export interface RulesStudioProps {
  rulesetId: string;
  rulesetName: string;
  isDefault: boolean;
  rules: RuleRowView[];
  simulation?: SimulationView | undefined;
  /** Every set this workspace may look at, so one can be chosen. */
  rulesets?: RulesetChoice[] | undefined;
  outcome?: string | undefined;
  forkAction?: Action | undefined;
  setOutcomeAction?: Action | undefined;
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
  rulesetId,
  isDefault,
  rules,
  simulation,
  rulesets,
  outcome,
  forkAction,
  setOutcomeAction,
}: RulesStudioProps): ReactElement {
  const notice = rulesNotice(outcome);
  const editable = !isDefault && setOutcomeAction !== undefined;
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="قواعد القرار"
        subtitle="متى يُقبل الملف، ومتى يذهب للمراجعة. أول قاعدة تنطبق تحسم النتيجة."
      />

      <p className="muted">
        {rulesetName}
        {isDefault ? ' · افتراضي النظام، غير قابل للتعديل' : ' · خاصة بهذا المشترك'}
      </p>

      {notice === null ? null : (
        <p
          className={`notice notice-${notice.tone}`}
          data-role="rules-outcome"
          data-tone={notice.tone}
          style={{ margin: 0 }}
        >
          {notice.text}
        </p>
      )}

      {rulesets === undefined || rulesets.length < 2 ? null : (
        <nav
          className="row"
          data-role="ruleset-choice"
          style={{ gap: 'var(--s-2)', flexWrap: 'wrap' }}
        >
          {rulesets.map((set) => (
            <Link
              key={set.id}
              className={`btn ${set.id === rulesetId ? 'btn-secondary' : 'btn-ghost'}`}
              href={`/settings/rules?ruleset=${set.id}`}
            >
              {set.nameAr}
            </Link>
          ))}
        </nav>
      )}

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
            سجلاً: مقبول{' '}
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
            سجلاً عمّا هو مسجّل الآن.
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
              <tr key={rule.seq} data-outcome={rule.outcome} data-item={String(rule.seq)}>
                <td>
                  <bdi dir="ltr" className="mono">
                    {rule.seq}
                  </bdi>
                </td>
                <td>{rule.description}</td>
                <td>
                  {editable ? (
                    <form
                      action={setOutcomeAction}
                      className="row"
                      data-role="set-outcome"
                      style={{ gap: 'var(--s-2)' }}
                    >
                      <input type="hidden" name="ruleset_id" value={rulesetId} />
                      <input type="hidden" name="seq" value={rule.seq} />
                      <select
                        name="outcome"
                        defaultValue={rule.outcome}
                        aria-label={`نتيجة القاعدة ${rule.seq}`}
                        style={{ width: 'auto' }}
                      >
                        {(Object.keys(OUTCOME_LABELS) as RuleRowView['outcome'][]).map((value) => (
                          <option key={value} value={value}>
                            {OUTCOME_LABELS[value]}
                          </option>
                        ))}
                      </select>
                      <SubmitButton variant="ghost" data-role="save-rule" pendingLabel="جارٍ الحفظ">
                        احفظ
                      </SubmitButton>
                    </form>
                  ) : (
                    OUTCOME_LABELS[rule.outcome]
                  )}
                </td>
                <td className="muted">{rule.reasonAr}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="row" style={{ gap: 'var(--s-2)', flexWrap: 'wrap' }}>
        {/*
          The simulation is a link rather than a button: it writes nothing, and a question
          you can bookmark and send to a colleague is better than one you have to re-ask.
        */}
        <Link
          className="btn btn-secondary"
          data-role="simulate"
          href={`/settings/rules?ruleset=${rulesetId}&simulate=1`}
        >
          حاكِ على البيانات القائمة
        </Link>
      </div>

      {forkAction === undefined ? null : (
        <Panel
          title="نسخة خاصة بك"
          note="قواعد المنصة الافتراضية يرثها كل مشترك، فلا تُعدَّل. انسخها ثم عدّل النسخة."
        >
          <form
            action={forkAction}
            className="panel-body row"
            data-role="fork-ruleset"
            style={{ gap: 'var(--s-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}
          >
            <input type="hidden" name="from_ruleset" value={rulesetId} />
            <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '180px' }}>
              <span className="stat-label">الاسم</span>
              <input name="name_ar" required placeholder="قواعدنا للموردين" />
            </label>
            <label className="stack" style={{ gap: 'var(--s-1)', minWidth: '150px' }}>
              <span className="stat-label">الرمز</span>
              <input name="code" dir="ltr" required placeholder="SUPPLIERS" />
            </label>
            <SubmitButton variant="primary" data-role="fork-submit" pendingLabel="جارٍ النسخ">
              انسخ هذه المجموعة
            </SubmitButton>
          </form>
        </Panel>
      )}
    </div>
  );
}
