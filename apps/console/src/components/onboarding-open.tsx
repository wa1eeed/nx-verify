import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';
import { SubmitButton } from './ui/submit-button';

/**
 * Opening an onboarding file (ADR-148).
 *
 * The list screen's primary action pointed here and this page did not exist, so the only way
 * into onboarding from the console was a 404.
 *
 * One number and one journey, because that is all a file needs to start: the journey says
 * which checks run and in what order, and the checks read the applicant from the registry
 * themselves. Asking for anything more here would be asking a person to type what we are
 * about to go and find out.
 *
 * And opening runs it. A person opening a file wants an answer, not a handle.
 */

export interface JourneyView {
  code: string;
  nameAr: string;
  descriptionAr: string | null;
  stepCount: number;
  slaHours: number;
}

const REFUSALS: Record<string, string> = {
  missing: 'اختر مساراً واكتب الرقم.',
  journey: 'هذا المسار لم يعد مفعّلاً.',
  failed: 'لم يُفتح الملف. حاول مرة أخرى.',
};

export function OpenCase({
  journeys,
  refused,
  action,
}: {
  journeys: JourneyView[];
  refused?: string | undefined;
  action: (formData: FormData) => void | Promise<void>;
}): ReactElement {
  const notice = refused === undefined ? null : (REFUSALS[refused] ?? REFUSALS['failed']);

  return (
    <div className="stack" data-role="open-case" style={{ gap: 'var(--s-4)' }}>
      <PageHeader
        title="فتح ملف تأهيل"
        subtitle="اختر المسار واكتب رقم المنشأة. تعمل الفحوص فور الفتح."
      />

      {notice === undefined || notice === null ? null : (
        <p className="notice notice-refused" data-role="open-refused" style={{ margin: 0 }}>
          {notice}
        </p>
      )}

      {journeys.length === 0 ? (
        <EmptyState>لا مسارات تأهيل مفعّلة. راجع مشغّل المنصة.</EmptyState>
      ) : (
        <Panel
          title="الملف الجديد"
          note="الفحوص تقرأ المنشأة من الجهات بنفسها. لا نطلب منك كتابة ما سنذهب لمعرفته."
        >
          <form action={action} className="panel-body stack" style={{ gap: 'var(--s-4)' }}>
            <fieldset
              className="stack"
              style={{ gap: 'var(--s-2)', border: 0, padding: 0, margin: 0 }}
            >
              <legend className="stat-label">المسار</legend>
              <div className="stack" style={{ gap: 'var(--s-2)' }}>
                {journeys.map((journey, index) => (
                  <label
                    key={journey.code}
                    className="row channel-card"
                    data-item={journey.code}
                    style={{ gap: 'var(--s-3)', alignItems: 'flex-start' }}
                  >
                    <input
                      type="radio"
                      name="journey"
                      value={journey.code}
                      defaultChecked={index === 0}
                    />
                    <span className="stack" style={{ gap: 'var(--s-1)' }}>
                      <strong>{journey.nameAr}</strong>
                      {journey.descriptionAr === null ? null : (
                        <span className="muted">{journey.descriptionAr}</span>
                      )}
                      <span className="stat-hint">
                        {journey.stepCount} فحوص · المهلة {journey.slaHours} ساعة
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
              <label className="stack" style={{ gap: 'var(--s-1)', minWidth: '200px' }}>
                <span className="stat-label">الرقم الموحد أو السجل التجاري</span>
                <input
                  name="number"
                  dir="ltr"
                  inputMode="numeric"
                  required
                  placeholder="7001234567"
                />
              </label>
              <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '180px' }}>
                <span className="stat-label">مرجعك، اختياري</span>
                <input name="client_ref" placeholder="طلب رقم 1204" />
              </label>
            </div>

            <div>
              <SubmitButton
                variant="primary"
                data-role="open-case-submit"
                pendingLabel="جارٍ الفتح"
              >
                افتح وابدأ الفحوص
              </SubmitButton>
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}
