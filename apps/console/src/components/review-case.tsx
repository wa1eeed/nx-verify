import Link from 'next/link';
import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';
import { SubmitButton } from './ui/submit-button';
import { reasonLabel } from './review-queue';
import { isoDate } from './format';

/**
 * One review case, and the four things a person can do to it (ADR-146).
 *
 * The screen is built around the control it exists to enforce: **whoever decides cannot be
 * whoever approves**. So the decision and the approval are two panels, not two buttons in a
 * row, and the panel that approves names the person who decided. The rule itself is refused
 * in the domain and in a trigger underneath it; this screen states it and shows the refusal
 * when it fires, rather than hiding the button and quietly teaching nobody why.
 *
 * A decision needs a written reason. It is the one free text field the platform has (rule 6's
 * single exception), and it exists because a decision with no stated reason is not reviewable
 * a year later, which is when it is read.
 */

export interface ReviewCaseView {
  caseId: string;
  entityId: string;
  entityName: string | null;
  status: 'OPEN' | 'ASSIGNED' | 'DECIDED' | 'CLOSED';
  reasonCodes: string[];
  priority: string;
  assignedTo: string | null;
  assignedToName: string | null;
  outcome: 'PASS' | 'FAIL' | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  openedAt: Date;
  slaDueAt: Date;
  ageHours: number;
  overdue: boolean;
}

const STATUS_LABELS: Record<ReviewCaseView['status'], string> = {
  OPEN: 'مفتوحة',
  ASSIGNED: 'مسندة',
  DECIDED: 'بانتظار الاعتماد',
  CLOSED: 'مغلقة',
};

const OUTCOME_LABELS: Record<'PASS' | 'FAIL', string> = {
  PASS: 'مقبولة',
  FAIL: 'مرفوضة',
};

const OUTCOMES: Record<string, { tone: 'done' | 'refused'; text: string }> = {
  assigned: { tone: 'done', text: 'أُسندت الحالة إليك.' },
  decided: { tone: 'done', text: 'سُجّل القرار. يحتاج اعتماد شخص آخر.' },
  approved: { tone: 'done', text: 'اعتُمد القرار وأُغلقت الحالة.' },
  returned: { tone: 'done', text: 'أُعيدت الحالة إلى المقرِّر.' },
  note: { tone: 'refused', text: 'القرار يحتاج سبباً مكتوباً. قرار بلا سبب لا يُراجَع بعد سنة.' },
  reason: { tone: 'refused', text: 'الإعادة تحتاج سبباً مكتوباً.' },
  role: { tone: 'refused', text: 'دورك لا يسمح بهذا الإجراء.' },
  'four-eyes': {
    tone: 'refused',
    text: 'لا يعتمد القرارَ من اتخذه. يحتاج اعتماد شخص آخر.',
  },
  state: { tone: 'refused', text: 'حالة الملف لا تسمح بهذا الإجراء الآن.' },
  failed: { tone: 'refused', text: 'لم يُنفَّذ الإجراء. حاول مرة أخرى.' },
};

export function caseOutcomeNotice(
  outcome: string | undefined,
): { tone: 'done' | 'refused'; text: string } | null {
  return outcome === undefined ? null : (OUTCOMES[outcome] ?? null);
}

type Action = (formData: FormData) => void | Promise<void>;

export interface ReviewCaseProps {
  item: ReviewCaseView;
  /** Who is looking, so the screen can say «أنت» where it means the reader. */
  viewerId: string;
  canDecide: boolean;
  canApprove: boolean;
  outcome?: string | undefined;
  assignAction: Action;
  decideAction: Action;
  approveAction: Action;
  returnAction: Action;
}

export function ReviewCase({
  item,
  viewerId,
  canDecide,
  canApprove,
  outcome,
  assignAction,
  decideAction,
  approveAction,
  returnAction,
}: ReviewCaseProps): ReactElement {
  const notice = caseOutcomeNotice(outcome);
  const decidedByViewer = item.decidedBy === viewerId;
  const open = item.status === 'OPEN' || item.status === 'ASSIGNED';

  return (
    <div className="stack" data-role="review-case" style={{ gap: 'var(--s-4)' }}>
      <PageHeader
        title={item.entityName ?? 'حالة مراجعة'}
        subtitle={`${STATUS_LABELS[item.status]} · فُتحت ${isoDate(item.openedAt)}`}
      />

      {notice === null ? null : (
        <p
          className={`notice notice-${notice.tone}`}
          data-role="case-outcome"
          data-tone={notice.tone}
          style={{ margin: 0 }}
        >
          {notice.text}
        </p>
      )}

      <Panel title="لماذا هي مفتوحة" role="case-reasons">
        <div className="panel-body stack" style={{ gap: 'var(--s-2)' }}>
          <ul className="stack" style={{ gap: 'var(--s-1)', margin: 0 }}>
            {item.reasonCodes.map((code) => (
              <li key={code}>{reasonLabel(code)}</li>
            ))}
          </ul>
          <p className="faint" style={{ margin: 0 }}>
            المهلة {isoDate(item.slaDueAt)}
            {item.overdue ? ' · متأخرة' : null} ·{' '}
            <Link prefetch={false} href={`/customers/${item.entityId}`}>
              افتح ملف العميل
            </Link>
          </p>
        </div>
      </Panel>

      {item.decidedBy === null ? null : (
        <Panel title="القرار" role="case-decision">
          <div className="panel-body stack" style={{ gap: 'var(--s-2)' }}>
            <p style={{ margin: 0 }}>
              <strong>
                {item.outcome === null ? 'بلا نتيجة مسجّلة' : OUTCOME_LABELS[item.outcome]}
              </strong>
              {' · '}
              {item.decidedByName ?? item.decidedBy}
              {decidedByViewer ? ' (أنت)' : null}
            </p>
            {/* The one free text field in the platform, and the reason it exists. */}
            <p className="muted" style={{ margin: 0 }}>
              {item.decisionNote}
            </p>
          </div>
        </Panel>
      )}

      {open && item.assignedTo !== viewerId ? (
        <Panel title="الإسناد" role="case-assign">
          <div className="panel-body">
            <form action={assignAction}>
              <input type="hidden" name="case_id" value={item.caseId} />
              <SubmitButton data-role="assign-case" pendingLabel="جارٍ الإسناد">
                أسندها إليّ
              </SubmitButton>
            </form>
          </div>
        </Panel>
      ) : null}

      {open && canDecide ? (
        <Panel
          title="القرار"
          note="السبب إلزامي. قرارٌ بلا سبب مكتوب لا يُراجَع بعد سنة، وحينها يُقرأ."
          role="case-decide"
        >
          <form action={decideAction} className="panel-body stack" style={{ gap: 'var(--s-3)' }}>
            <input type="hidden" name="case_id" value={item.caseId} />
            <label className="stack" style={{ gap: 'var(--s-1)' }}>
              <span className="stat-label">السبب</span>
              <textarea name="note" rows={3} required />
            </label>
            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <SubmitButton
                variant="primary"
                name="outcome"
                value="PASS"
                data-role="decide-pass"
                pendingLabel="جارٍ التسجيل"
              >
                اقبل
              </SubmitButton>
              <SubmitButton
                variant="secondary"
                name="outcome"
                value="FAIL"
                data-role="decide-fail"
                pendingLabel="جارٍ التسجيل"
              >
                ارفض
              </SubmitButton>
            </div>
          </form>
        </Panel>
      ) : null}

      {item.status === 'DECIDED' && canApprove ? (
        <Panel
          title="الاعتماد"
          note="لا يعتمد القرارَ من اتخذه. هذا الفصل هو الضابط نفسه، لا تفصيلاً في الشاشة."
          role="case-approve"
        >
          <div className="panel-body stack" style={{ gap: 'var(--s-3)' }}>
            {decidedByViewer ? (
              // Said rather than hidden: a reviewer who cannot see why the button is missing
              // learns nothing, and asks a colleague instead of reading the rule.
              <p className="notice notice-refused" data-role="own-decision" style={{ margin: 0 }}>
                أنت من اتخذ هذا القرار، فلا يمكنك اعتماده. يحتاج شخصاً آخر.
              </p>
            ) : (
              <form action={approveAction}>
                <input type="hidden" name="case_id" value={item.caseId} />
                <SubmitButton data-role="approve-case" pendingLabel="جارٍ الاعتماد">
                  اعتمد وأغلق
                </SubmitButton>
              </form>
            )}
            <form action={returnAction} className="stack" style={{ gap: 'var(--s-2)' }}>
              <input type="hidden" name="case_id" value={item.caseId} />
              <label className="stack" style={{ gap: 'var(--s-1)' }}>
                <span className="stat-label">أو أعِدها بسبب</span>
                <textarea name="reason" rows={2} />
              </label>
              <div>
                <SubmitButton
                  variant="secondary"
                  data-role="return-case"
                  pendingLabel="جارٍ الإعادة"
                >
                  أعِدها إلى المقرِّر
                </SubmitButton>
              </div>
            </form>
          </div>
        </Panel>
      ) : null}

      {item.status === 'CLOSED' ? (
        <EmptyState>أُغلقت هذه الحالة. لا إجراء عليها.</EmptyState>
      ) : null}
    </div>
  );
}
