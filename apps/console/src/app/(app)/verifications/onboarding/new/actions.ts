'use server';

import { after } from 'next/server';
import { redirect } from 'next/navigation';
import { NxError, advanceCase, audit, inferIdentifiers, openOnboardingCase } from '@nx-verify/core';
import { actingUser, currentTenantId, query } from '../../../../../lib/context';
import { getKeys } from '../../../../../lib/keys';
import { checkDependenciesFor } from '../../../../../lib/verification';

/**
 * Opening an onboarding file from the console (ADR-148).
 *
 * The screen's own primary action pointed at `/verifications/onboarding/new`, which did not
 * exist and fell through to the `[id]` route and a 404. The only way into onboarding from
 * this console was broken, while the API has been able to open and run a case since the
 * onboarding unit.
 *
 * One press opens the file **and runs it**, the way the API does, because a person opening a
 * file wants an answer and not a handle. The checks run after the response is sent, so the
 * screen comes back at once and the file fills in; a file that stalls is picked up by the
 * worker's sweep exactly as a stalled request is.
 */

export async function openCaseAction(formData: FormData): Promise<void> {
  const user = await actingUser();
  const tenantId = await currentTenantId();
  const journeyCode = String(formData.get('journey') ?? '').trim();
  const clientRef = String(formData.get('client_ref') ?? '').trim();
  const number = String(formData.get('number') ?? '')
    .trim()
    .replace(/[\s-]/g, '');

  if (journeyCode === '' || number === '') {
    redirect('/verifications/onboarding/new?refused=missing');
  }

  // The applicant's record, read the same way the API reads one (rule 4 keeps it out of the
  // case row: what the case keeps is the entity the first check resolved).
  const subject = { unn: number, cr_number: number };
  const identifiers = inferIdentifiers(subject);

  let caseId: string;
  try {
    caseId = await query(async (tx) => {
      const opened = await openOnboardingCase(tx, {
        journeyCode,
        clientRef: clientRef === '' ? null : clientRef,
        openedBy: user.userId,
      });
      await audit(tx, {
        actorType: 'USER',
        actorId: user.userId,
        action: 'onboarding.opened',
        target: opened.caseId,
        // The journey and the reference the subscriber chose. Never the number typed: that
        // is an identifier, and rule 4 keeps it out of every log and every audit row.
        metadata: { journey: journeyCode, reference: opened.reference },
      });
      return opened.caseId;
    });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    redirect(
      `/verifications/onboarding/new?refused=${
        error instanceof NxError && error.code === 'NX-4041' ? 'journey' : 'failed'
      }`,
    );
  }

  after(async () => {
    try {
      const deps = await checkDependenciesFor(tenantId);
      await deps.inTenant((tx) =>
        advanceCase(tx, {
          caseId,
          subject,
          subjectIdentifiers: identifiers,
          runStep: deps.runStepFor(tx),
          keys: getKeys(),
        }),
      );
    } catch (error) {
      // The worker's sweep takes it from here. The log names the case, never what was typed
      // for it (rule 4).
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'onboarding case stopped',
          case_id: caseId,
          code: error instanceof NxError ? error.code : 'NX-5001',
        }),
      );
    }
  });

  redirect(`/verifications/onboarding/${caseId}`);
}

/** A redirect inside a try is a thrown value, not a failure: it has to travel. */
function isRedirect(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}
