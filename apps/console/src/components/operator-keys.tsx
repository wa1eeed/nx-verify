import type { ReactElement } from 'react';
import { Card } from './ui/card';
import { SubmitButton } from './ui/submit-button';
import { Ltr } from './ui/ltr';
import { dateAr } from './format';

/**
 * Which key version is written with, and which are still readable (ADR-152).
 *
 * The rotation job has always existed: it re-encrypts rows onto «the current key». Nothing
 * could declare a new current key or retire an old one, so rotation was a mover with no
 * control. `listKeyVersions`, `activateKeyVersion` and `retireKeyVersion` had no callers.
 *
 * The order the screen enforces is the order the platform's own docstrings describe, because
 * getting it wrong is not recoverable: **activate, then run the job, then retire**. A version
 * retired while a row still reads it makes that row unreadable, and a sealed evidence
 * document retired out from under its signature becomes uncheckable. So retiring is offered
 * only on a retiring version, never on the active one, and the screen says why.
 */

export interface KeyVersionView {
  version: number;
  status: 'active' | 'retiring' | 'retired';
  activatedAt: Date;
  retiredAt: Date | null;
  notes: string | null;
}

const STATUS_LABELS: Record<KeyVersionView['status'], string> = {
  active: 'يُكتب بها الآن',
  retiring: 'تُقرأ ولا يُكتب بها',
  retired: 'متقاعدة',
};

const OUTCOMES: Record<string, { tone: 'done' | 'refused'; text: string }> = {
  activated: {
    tone: 'done',
    text: 'صارت هذه النسخة هي التي يُكتب بها. شغّل مهمة التدوير حتى تنتقل الصفوف، ثم تقاعد القديمة.',
  },
  retired: { tone: 'done', text: 'تقاعدت النسخة. لم تعد تُقرأ.' },
  invalid: { tone: 'refused', text: 'رقم النسخة عدد صحيح موجب.' },
  'not-retiring': {
    tone: 'refused',
    text: 'لا تتقاعد إلا نسخة في وضع «تُقرأ ولا يُكتب بها». والنسخة الفعّالة لا تتقاعد أبداً.',
  },
  failed: { tone: 'refused', text: 'لم يُنفَّذ الإجراء. حاول مرة أخرى.' },
};

export function keyNotice(
  outcome: string | undefined,
): { tone: 'done' | 'refused'; text: string } | null {
  return outcome === undefined ? null : (OUTCOMES[outcome] ?? null);
}

type Action = (formData: FormData) => void | Promise<void>;

export function OperatorKeys({
  versions,
  outcome,
  canEdit,
  activateAction,
  retireAction,
}: {
  versions: KeyVersionView[];
  outcome?: string | undefined;
  canEdit: boolean;
  activateAction?: Action | undefined;
  retireAction?: Action | undefined;
}): ReactElement {
  const notice = keyNotice(outcome);
  const highest = versions.reduce((top, row) => Math.max(top, row.version), 0);

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      {notice === null ? null : (
        <p
          className={`notice notice-${notice.tone}`}
          data-role="keys-outcome"
          data-tone={notice.tone}
          style={{ margin: 0 }}
        >
          {notice.text}
        </p>
      )}

      <Card role="key-versions" labelledBy="key-versions-title">
        <h2 className="card-title admin-card-title" id="key-versions-title">
          إصدارات المفاتيح
        </h2>
        <p className="admin-card-note">
          الترتيب إلزامي ولا رجعة فيه:{' '}
          <strong>فعّل، ثم شغّل التدوير حتى تنتقل الصفوف، ثم تقاعد القديمة</strong>. نسخةٌ تتقاعد
          وصفٌّ ما زال يقرؤها تجعل ذلك الصف غير مقروء، ومستند دليل مختوم تُسحب من تحته نسخته يصير
          غير قابل للتحقق.
        </p>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>النسخة</th>
                <th>الحالة</th>
                <th>فُعّلت</th>
                <th>ملاحظة</th>
                {canEdit ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {versions.map((row) => (
                <tr key={row.version} data-role="key-version" data-status={row.status}>
                  <td>
                    <Ltr>{row.version}</Ltr>
                  </td>
                  <td>{STATUS_LABELS[row.status]}</td>
                  <td>
                    <Ltr>{dateAr(row.activatedAt)}</Ltr>
                  </td>
                  <td className="muted">{row.notes}</td>
                  {canEdit ? (
                    <td>
                      {row.status === 'retiring' && retireAction !== undefined ? (
                        <form action={retireAction}>
                          <input type="hidden" name="version" value={row.version} />
                          <SubmitButton
                            variant="ghost"
                            data-role="retire-version"
                            pendingLabel="جارٍ التقاعد"
                          >
                            تقاعد
                          </SubmitButton>
                        </form>
                      ) : (
                        <span className="faint">
                          {row.status === 'active' ? 'لا تتقاعد الفعّالة' : '—'}
                        </span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {canEdit && activateAction !== undefined ? (
        <Card role="activate-key" labelledBy="activate-key-title">
          <h2 className="card-title admin-card-title" id="activate-key-title">
            تفعيل نسخة جديدة
          </h2>
          <p className="admin-card-note">
            النسخة الفعّالة الحالية تصير «تُقرأ ولا يُكتب بها»، ويبقى كل ما كُتب بها مقروءاً حتى
            ينقله التدوير. أضف مادة النسخة إلى خدمة المفاتيح أو إلى ملف المفتاح أولاً: رقمٌ يُفعَّل
            بلا مادة تقابله يوقف الكتابة.
          </p>
          <form action={activateAction} className="admin-settings-fields">
            <label className="stack" style={{ gap: 'var(--s-1)' }}>
              <span className="stat-label">رقم النسخة</span>
              <input
                name="version"
                dir="ltr"
                inputMode="numeric"
                required
                defaultValue={highest + 1}
                style={{ width: '8ch' }}
              />
            </label>
            <label className="stack" style={{ gap: 'var(--s-1)' }}>
              <span className="stat-label">ملاحظة، اختيارية</span>
              <input name="notes" placeholder="تدوير ربع سنوي" />
            </label>
            <SubmitButton data-role="activate-version" pendingLabel="جارٍ التفعيل">
              فعّل هذه النسخة
            </SubmitButton>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
