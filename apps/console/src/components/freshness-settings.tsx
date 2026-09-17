import type { ReactElement } from 'react';
import { fieldLabel } from './field-card';
import { PageHeader } from './page-header';
import { SubmitButton } from './ui/submit-button';

/**
 * The retention settings screen.
 *
 * Three things this screen must say out loud, from docs/01-blueprint.md section 6.1:
 *
 *   Where each value came from, so an operator can tell what they changed from what they
 *   inherited, and put it back.
 *
 *   That editing a duration rewrites no fact. It recomputes. People assume an edit like
 *   this is destructive, and the sentence is cheaper than the support ticket.
 *
 *   What the change will do before it is saved. "340 entities move to expired" is the
 *   difference between an informed decision and an alert storm on Monday.
 *
 * And it can now act on its own answer (ADR-146). The preview worked from the first day and
 * nothing could apply it, so a subscriber could ask what a change would do and then had no
 * way to say yes. Each row saves on its own: one field's duration is one decision.
 */

export interface PolicyRowView {
  fieldPath: string;
  ttlDays: number;
  weight: number;
  source: 'system' | 'tenant';
}

export interface ImpactPreview {
  fieldPath: string;
  proposedTtlDays: number;
  newlyExpired: number;
}

const OUTCOMES: Record<string, { tone: 'done' | 'refused'; text: string }> = {
  saved: { tone: 'done', text: 'حُفظت المدة. لم تتغيّر أي إفادة، أُعيد الحساب فقط.' },
  cleared: { tone: 'done', text: 'عاد الحقل إلى افتراضي النظام.' },
  invalid: {
    tone: 'refused',
    text: 'لم تُحفظ: المدة من يوم إلى 3650 يوماً، والوزن من 0 إلى 100.',
  },
  failed: { tone: 'refused', text: 'لم يُحفظ التغيير. حاول مرة أخرى.' },
};

export function freshnessNotice(
  outcome: string | undefined,
): { tone: 'done' | 'refused'; text: string } | null {
  return outcome === undefined ? null : (OUTCOMES[outcome] ?? null);
}

type Action = (formData: FormData) => void | Promise<void>;

export function FreshnessSettings({
  rows,
  preview,
  outcome,
  saveAction,
  clearAction,
}: {
  rows: PolicyRowView[];
  preview?: ImpactPreview | undefined;
  outcome?: string | undefined;
  /**
   * Absent on a screen that only reports; present makes every row editable. It carries both
   * «ask what this would do» and «do it»: which one is a field on the form, because a second
   * action on the button does not survive the association the inputs need across the cells.
   */
  saveAction?: Action | undefined;
  clearAction?: Action | undefined;
}): ReactElement {
  const editable = saveAction !== undefined;
  const notice = freshnessNotice(outcome);
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader title="مدد الصلاحية" subtitle="كم يبقى كل حقل صالحاً قبل إعادة التحقق منه." />

      {notice === null ? null : (
        <p
          className={`notice notice-${notice.tone}`}
          data-role="freshness-outcome"
          data-tone={notice.tone}
          style={{ margin: 0 }}
        >
          {notice.text}
        </p>
      )}

      <p className="card muted" data-role="inert-notice">
        تعديل المدة لا يغيّر أي إفادة سابقة. تُعاد الحسابات فقط، والحقائق تبقى كما سُجّلت.
      </p>

      {preview ? (
        <section className="card stack" data-role="impact-preview">
          <strong>معاينة الأثر قبل الحفظ</strong>
          <p>
            تغيير {fieldLabel(preview.fieldPath)} إلى{' '}
            <bdi dir="ltr" className="mono">
              {preview.proposedTtlDays}
            </bdi>{' '}
            يوماً سينقل{' '}
            <bdi dir="ltr" className="mono">
              {preview.newlyExpired}
            </bdi>{' '}
            سجلاً إلى حالة منتهي الصلاحية.
          </p>
        </section>
      ) : null}

      <section className="card">
        <table>
          <thead>
            <tr>
              <th>المعلومة</th>
              <th>المدة بالأيام</th>
              <th>الوزن في الدرجة</th>
              <th>المصدر</th>
              {editable ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.fieldPath} data-source={row.source} data-item={row.fieldPath}>
                <td>{fieldLabel(row.fieldPath)}</td>
                <td>
                  {editable ? (
                    <input
                      form={`ttl-${row.fieldPath}`}
                      name="ttl_days"
                      dir="ltr"
                      inputMode="numeric"
                      defaultValue={row.ttlDays}
                      aria-label={`مدة ${fieldLabel(row.fieldPath)} بالأيام`}
                      style={{ width: '7ch' }}
                    />
                  ) : (
                    <bdi dir="ltr" className="mono">
                      {row.ttlDays}
                    </bdi>
                  )}
                </td>
                <td>
                  {/* The weight moves with the duration. A duration without a weight has
                      no meaning in the confidence score. */}
                  {editable ? (
                    <input
                      form={`ttl-${row.fieldPath}`}
                      name="weight"
                      dir="ltr"
                      inputMode="numeric"
                      defaultValue={row.weight}
                      aria-label={`وزن ${fieldLabel(row.fieldPath)}`}
                      style={{ width: '7ch' }}
                    />
                  ) : (
                    <bdi dir="ltr" className="mono">
                      {row.weight}
                    </bdi>
                  )}
                </td>
                <td className="muted">
                  {row.source === 'system' ? 'افتراضي النظام' : 'معدّل من المشترك'}
                </td>
                {editable ? (
                  <td>
                    <div className="row" style={{ gap: 'var(--s-2)' }}>
                      {/*
                        One form, two buttons, and which was pressed is a field. A second
                        action on the button itself does not survive the `form` attribute the
                        inputs need to reach across the row's cells, and a form element is not
                        valid between a row and its cells.
                      */}
                      <form
                        id={`ttl-${row.fieldPath}`}
                        action={saveAction}
                        className="row"
                        style={{ gap: 'var(--s-2)' }}
                      >
                        <input type="hidden" name="field_path" value={row.fieldPath} />
                        <SubmitButton
                          name="intent"
                          value="preview"
                          variant="ghost"
                          data-role="preview-ttl"
                          pendingLabel="جارٍ الحساب"
                        >
                          عاين
                        </SubmitButton>
                        <SubmitButton
                          name="intent"
                          value="save"
                          variant="secondary"
                          data-role="save-ttl"
                          pendingLabel="جارٍ الحفظ"
                        >
                          احفظ
                        </SubmitButton>
                      </form>
                      {row.source === 'tenant' && clearAction !== undefined ? (
                        <form action={clearAction}>
                          <input type="hidden" name="field_path" value={row.fieldPath} />
                          <SubmitButton
                            variant="ghost"
                            data-role="clear-ttl"
                            pendingLabel="جارٍ الإرجاع"
                          >
                            أعِده للافتراضي
                          </SubmitButton>
                        </form>
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {editable ? (
        <p className="faint" style={{ margin: 0 }}>
          كل حقل يُحفظ وحده: مدة حقل واحد قرار واحد. و«عاين» يسأل ولا يغيّر شيئاً.
        </p>
      ) : null}
    </div>
  );
}
