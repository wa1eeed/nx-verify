import type { ReactElement, ReactNode } from 'react';
import { NOT_CHARGED_AR, chargedOutcomesSentenceAr, type ChargedOutcomes } from '@nx-verify/core';
import type { CustomerFile, PartyRoles } from '@nx-verify/core';
import { CheckResults, type CheckResultView } from '../check-results';
import type { FieldHistoryView } from '../field-card';
import { riyals } from '../format';
import { SubmitButton } from '../ui/submit-button';
import { DialogButton, ExportFileButton, FileWatcher } from './actions';
import {
  IndicatorsCard,
  IntersectionsCard,
  RiskCard,
  TimelineCard,
  type TimelineEntry,
} from './aside';
import { FileHeader, IndicatorStrip } from './header';
import { RolesCard } from './party';
import { SectionCard, customerKindOf, type Action, type SectionContext } from './section';
import type { SectionCheckAction } from './section-live';

export type { TimelineEntry, TimelineField } from './aside';

/**
 * A customer's file (handoff screen 03).
 *
 * The head with the name and the file's actions; the four figures that say where it stands;
 * then the sections, numbered for this kind of customer, each with its own verify button,
 * beside the indicators, the reasons for the risk score, the links the facts reveal, and the
 * record of what was verified when.
 *
 * «تحديث كل الأقسام» asks before it spends: it runs every check this customer is offered,
 * and the dialog says how many and what they cost before anything is sent.
 */

export interface CustomerFileView {
  file: CustomerFile;
  /** One key for refreshing everything, one per section and one per manager. */
  bundles: {
    refreshAll: string;
    sections: Readonly<Record<string, string>>;
    managers: Readonly<Record<string, string>>;
  };
  prices: Readonly<Record<string, number | null>>;
  /**
   * What each check charges when the answer is not a plain success, from the price row in
   * force (ADR-170). Absent while the page has not read it, and the dialog then says only
   * the part that holds for every price row instead of a share it has not seen.
   */
  shares?: Readonly<Record<string, ChargedOutcomes | undefined>> | undefined;
  refusals: Readonly<Record<string, string | null>>;
  fromPackage: boolean;
  /** The subscriber shows prices on the verification screens (README, screen 02). */
  showPrices: boolean;
  results: CheckResultView[] | null;
  /** The checks queued or running for this customer right now, from any request. */
  running: readonly string[];
  error: string | null;
  histories: Readonly<Record<string, FieldHistoryView[]>>;
  timeline: TimelineEntry[];
  now: Date;
  /** The roles this customer also holds in other customers' companies, when it holds any. */
  roles?: PartyRoles | null | undefined;
  /** Per company of those roles, the checks queued or running on it. */
  companyRunning?: Readonly<Record<string, readonly string[]>> | undefined;
  /** Per company of those roles, the key a manager check from this file is made under. */
  companyBundles?: Readonly<Record<string, string>> | undefined;
}

/**
 * What this dialog may say about a run that does not come back a plain success.
 *
 * Read from the shares on each check's price row, never written out as a sentence: the
 * dialog used to promise «العمليات الفاشلة لا تُحسب» while an authority answering «لا يوجد»
 * was charged half the price and a cached answer all of it (ADR-170). When the shares have
 * not been read, or the checks in this dialog do not share one pair of them, it says the
 * half that is true of every price row and sends the reader to the screen that lists the
 * rest, rather than name a share for checks that do not have it in common.
 */
function chargedOutcomesNote(
  checks: readonly { productCode: string }[],
  shares: Readonly<Record<string, ChargedOutcomes | undefined>> | undefined,
): string {
  const known = checks
    .map((check) => shares?.[check.productCode])
    .filter((share): share is ChargedOutcomes => share !== undefined);
  const first = known[0];
  const uniform =
    first !== undefined &&
    known.length === checks.length &&
    known.every(
      (share) => share.notFoundPct === first.notFoundPct && share.cachedPct === first.cachedPct,
    );

  return uniform
    ? `${chargedOutcomesSentenceAr(first)}.`
    : `${NOT_CHARGED_AR}، وما تُحسب به الحالات الأخرى في «أسعار المنتجات».`;
}

const ERRORS: Readonly<Record<string, string>> = {
  iban: 'رقم الآيبان السعودي يبدأ بـSA ويتبعه 22 رقماً.',
  checks: 'حدّد عملية تحقق واحدة على الأقل.',
  failed: 'تعذّر بدء التحقق الآن. أعد المحاولة بعد قليل.',
};

export function CustomerFileScreen({
  view,
  action,
  sectionAction,
  watch,
  share,
}: {
  view: CustomerFileView;
  action: Action;
  /** A section's own verify, which stays on the page (the owner's ask). */
  sectionAction?: SectionCheckAction | undefined;
  /** Asks which of this customer's checks are still running, while some are. */
  watch?: ((entityId: string) => Promise<string[]>) | undefined;
  /** The share panel, drawn by the page. */
  share: { panel: ReactNode };
}): ReactElement {
  const { file } = view;
  const runnable = file.checks.filter((check) => check.availability === 'AVAILABLE');
  const managerRuns = Math.max(1, file.managers.length);
  const estimate = runnable.reduce((sum, check) => {
    const price = view.prices[check.productCode] ?? 0;
    return sum + (check.productCode === 'MANAGER_AUTHORITY' ? price * managerRuns : price);
  }, 0);

  const outcomesNote = chargedOutcomesNote(runnable, view.shares);

  const running = new Set(view.running);
  const context = (section: string): SectionContext => ({
    file,
    action,
    sectionAction,
    bundle: view.bundles.sections[section] ?? view.bundles.refreshAll,
    managerBundles: view.bundles.managers,
    refusals: view.refusals,
    histories: view.histories,
    running,
  });

  return (
    <div className="stack" style={{ gap: 'var(--layout-content-gap)' }} data-role="customer-file">
      {watch !== undefined && view.running.length > 0 ? (
        <FileWatcher entityId={file.entityId} running={view.running} watch={watch} />
      ) : null}
      {view.results ? <CheckResults results={view.results} /> : null}
      {view.error ? (
        <p className="sign-in-error" role="alert">
          {ERRORS[view.error] ?? 'تعذّر تنفيذ الطلب.'}
        </p>
      ) : null}

      <FileHeader
        file={file}
        actions={
          <>
            <ExportFileButton />
            <DialogButton label="مشاركة الملف" title="مشاركة الملف" role="open-share">
              {share.panel}
            </DialogButton>
            {runnable.length > 0 ? (
              <DialogButton
                label="تحديث كل الأقسام"
                title="تحديث كل الأقسام"
                icon="refresh-cw"
                variant="primary"
                role="refresh-all"
              >
                <form action={action} className="stack" style={{ gap: 'var(--space-4)' }}>
                  <input type="hidden" name="entity_id" value={file.entityId} />
                  <input
                    type="hidden"
                    name="kind"
                    value={file.entityType === 'FREELANCER' ? 'FREELANCER' : 'BUSINESS'}
                  />
                  <input type="hidden" name="customer_kind" value={customerKindOf(file)} />
                  <input type="hidden" name="bundle" value={view.bundles.refreshAll} />
                  {runnable.map((check) => (
                    <input
                      key={check.productCode}
                      type="hidden"
                      name="checks"
                      value={check.productCode}
                    />
                  ))}
                  <p style={{ margin: 0 }}>
                    يُعاد التحقق من {runnable.map((check) => check.nameAr).join('، ')}.
                    {file.managers.length > 1 ? ' وتحقق المدير يتكرر لكل مدير.' : ''}
                  </p>
                  <p className="faint" style={{ margin: 0 }}>
                    {view.fromPackage
                      ? 'تُحتسب هذه العمليات من باقتك لا من رصيدك.'
                      : view.showPrices
                        ? `التكلفة التقديرية ${riyals(estimate)} ريال قبل الضريبة، وهي سعر نجاح كل عملية كاملةً. ${outcomesNote}`
                        : `يُخصم من الرصيد عن كل عملية بحسب نتيجتها. ${outcomesNote}`}
                  </p>
                  <div className="dialog-actions">
                    <SubmitButton
                      variant="primary"
                      icon="refresh-cw"
                      disabled={running.size > 0}
                      title={running.size > 0 ? 'التحقق جارٍ على أقسام هذا الملف' : undefined}
                      pendingLabel="جارٍ التحديث"
                      data-role="run-refresh-all"
                    >
                      تحديث الآن
                    </SubmitButton>
                  </div>
                </form>
              </DialogButton>
            ) : null}
          </>
        }
      />

      <IndicatorStrip file={file} />

      <div className="file-grid">
        <div className="file-column">
          {file.sections.map((section) => (
            <SectionCard
              key={section.section}
              section={section}
              context={context(section.section)}
            />
          ))}
          {file.sections.length === 0 ? (
            <p className="empty">لا أقسام لهذا النوع من السجلات.</p>
          ) : null}
          {view.roles ? (
            <RolesCard
              file={file}
              roles={view.roles}
              refusals={view.refusals}
              running={view.companyRunning ?? {}}
              bundles={view.companyBundles ?? {}}
              sectionAction={sectionAction}
            />
          ) : null}
        </div>
        <aside className="file-column" aria-label="المؤشرات والتقاطعات">
          <IndicatorsCard assessment={file.assessment} />
          <RiskCard file={file} />
          <IntersectionsCard file={file} />
          <TimelineCard entries={view.timeline} />
        </aside>
      </div>
    </div>
  );
}
