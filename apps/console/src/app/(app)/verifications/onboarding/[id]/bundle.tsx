import type { ReactElement } from 'react';
import { Panel } from '../../../../../components/page-header';
import { dateTime } from '../../../../../components/format';
import { Ltr, Notice, SubmitButton, Table, TagLink, Th } from '../../../../../components/ui';

/**
 * The file's evidence bundle (docs/progress.md, the sealed bundle).
 *
 * A composite file asks for four or five checks about one applicant, and each of them was
 * sealed on its own. Four seals are not evidence that the file was completed: they are four
 * pages somebody has to assemble, and nothing binds them to the file that required them. The
 * bundle is one document over all of them, with one fingerprint and one signature.
 *
 * It sits under the file rather than beside the run buttons because it is the last thing done
 * to a file, and its button is secondary: the primary action of this screen is running what
 * the file still needs.
 */

export interface CaseSealView {
  evidenceId: string;
  contentHash: string;
  publicToken: string | null;
  signedAt: Date;
}

const OUTCOMES: Readonly<Record<string, { tone: 'done' | 'refused'; text: string }>> = {
  sealed: { tone: 'done', text: 'خُتمت حزمة الأدلة. البصمة أدناه هي ما يُفحَص به المستند.' },
  'nothing-to-seal': {
    tone: 'refused',
    text: 'لا يوجد في هذا الملف تحقق مكتمل بعد، ولا شيء يُختَم.',
  },
  'seal-failed': { tone: 'refused', text: 'لم تُختَم الحزمة. حاول مرة أخرى.' },
};

export function bundleNotice(
  outcome: string | undefined,
): { tone: 'done' | 'refused'; text: string } | null {
  return outcome === undefined ? null : (OUTCOMES[outcome] ?? null);
}

export function CaseBundlePanel({
  caseId,
  runCount,
  stepCount,
  seals,
  action,
  outcome,
}: {
  caseId: string;
  /** How many of the file's checks have a verification behind them. */
  runCount: number;
  stepCount: number;
  seals: readonly CaseSealView[];
  /** Absent for a reader who may not issue documents: the panel then only reports. */
  action?: ((formData: FormData) => void | Promise<void>) | undefined;
  outcome?: string | undefined;
}): ReactElement {
  const notice = bundleNotice(outcome);

  return (
    <Panel
      title="حزمة الأدلة"
      role="case-bundle"
      note="مستند واحد مختوم يغطي فحوص هذا الملف كلها ببصمة واحدة وتوقيع واحد، ويذكر الفحوص التي لم تُشغَّل وسببها. الختم لا يُعاد كتابته: كل ختم يحفظ ما كان صحيحاً في لحظته."
      aside={
        <>
          <Ltr>{runCount}</Ltr> من <Ltr>{stepCount}</Ltr> فحصاً مشمول
        </>
      }
    >
      {notice === null ? null : (
        <Notice tone={notice.tone} role="bundle-notice">
          {notice.text}
        </Notice>
      )}

      {runCount === 0 ? (
        <p className="muted" data-role="bundle-empty">
          لا يوجد تحقق مكتمل في هذا الملف بعد. تُختَم الحزمة بعد أول فحص.
        </p>
      ) : action === undefined ? null : (
        <form action={action} className="panel-body" data-role="seal-bundle">
          <input type="hidden" name="case_id" value={caseId} />
          <SubmitButton variant="secondary" data-role="seal-submit" pendingLabel="جارٍ الختم">
            اختم حزمة الأدلة
          </SubmitButton>
        </form>
      )}

      {seals.length === 0 ? (
        runCount === 0 ? null : (
          <p className="muted" data-role="no-seals">
            لم تُختَم حزمة لهذا الملف بعد.
          </p>
        )
      ) : (
        <Table label="حزم الأدلة المختومة" caption="حزم الأدلة المختومة لهذا الملف">
          <thead>
            <tr>
              <Th>وقت الختم</Th>
              <Th>البصمة</Th>
              <Th>رمز الصفحة العامة</Th>
              <Th>فحص المستند</Th>
            </tr>
          </thead>
          <tbody>
            {seals.map((seal) => (
              <tr key={seal.evidenceId} data-role="case-seal">
                <td>
                  <Ltr>{dateTime(seal.signedAt)}</Ltr>
                </td>
                <td>
                  {/* The number a holder compares against the page they were handed. */}
                  <bdi dir="ltr" className="mono" data-role="seal-hash">
                    {seal.contentHash}
                  </bdi>
                </td>
                <td>
                  {seal.publicToken === null ? (
                    <span className="muted">لا يوجد</span>
                  ) : (
                    <bdi dir="ltr" className="mono" data-role="seal-token">
                      {seal.publicToken}
                    </bdi>
                  )}
                </td>
                <td>
                  <TagLink
                    href={`/verifications/evidence?ref=${encodeURIComponent(seal.publicToken ?? seal.evidenceId)}`}
                    role="check-seal"
                  >
                    افحص
                  </TagLink>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
