'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  NxError,
  advanceCase,
  audit,
  getCase,
  inferIdentifiers,
  waiveStep,
  type WaiveReason,
} from '@nx-verify/core';
import { actingUser, currentTenantId, query } from '../../../../../lib/context';
import { getKeys } from '../../../../../lib/keys';
import { checkDependenciesFor } from '../../../../../lib/verification';

/**
 * Carrying an onboarding file forward, and setting a check aside (ADR-148).
 *
 * Both have existed in the domain and over the API since the onboarding unit, and the
 * console's case screen could only watch: staff could see a file stuck on a pending check and
 * had no way to run it or to say it was not needed.
 *
 * A waive is not a pass. It is a person saying, on the record, why a check was not run, from
 * a closed set of four reasons rather than free text, so the answer reads the same on every
 * screen and in every report a year later.
 */

const HERE = (caseId: string) => `/verifications/onboarding/${caseId}`;

function back(caseId: string, outcome: string): never {
  redirect(`${HERE(caseId)}?outcome=${outcome}`);
}

/**
 * Runs whatever the file still needs.
 *
 * The applicant's record is rebuilt from the identifiers the first check resolved, because
 * the case does not keep one: a subject holds identifiers, and a case that carried them
 * would be the one table in this platform that keeps them in the clear (rule 4).
 */
export async function advanceCaseAction(formData: FormData): Promise<void> {
  const user = await actingUser();
  const tenantId = await currentTenantId();
  const caseId = String(formData.get('case_id') ?? '');
  const number = String(formData.get('number') ?? '')
    .trim()
    .replace(/[\s-]/g, '');
  if (caseId === '' || number === '') {
    back(caseId, 'number');
  }

  const subject = { unn: number, cr_number: number };

  try {
    const deps = await checkDependenciesFor(tenantId);
    await deps.inTenant(async (tx) => {
      await advanceCase(tx, {
        caseId,
        subject,
        subjectIdentifiers: inferIdentifiers(subject),
        runStep: deps.runStepFor(tx),
        keys: getKeys(),
      });
      await audit(tx, {
        actorType: 'USER',
        actorId: user.userId,
        action: 'onboarding.advanced',
        target: caseId,
        // Never the number typed: it is an identifier (rule 4).
        metadata: {},
      });
    });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back(caseId, error instanceof NxError && error.code === 'NX-4031' ? 'closed' : 'failed');
  }

  revalidatePath(HERE(caseId));
  back(caseId, 'advanced');
}

export async function waiveStepAction(formData: FormData): Promise<void> {
  const user = await actingUser();
  const caseId = String(formData.get('case_id') ?? '');
  const stepKey = String(formData.get('step_key') ?? '');
  const reason = String(formData.get('reason') ?? '') as WaiveReason;
  if (caseId === '' || stepKey === '' || reason === ('' as WaiveReason)) {
    back(caseId, 'failed');
  }

  try {
    await query(async (tx) => {
      await waiveStep(tx, { caseId, stepKey, reason, actorId: user.userId });
      await audit(tx, {
        actorType: 'USER',
        actorId: user.userId,
        action: 'onboarding.waived',
        target: caseId,
        // Which check and on what grounds. This is the row somebody reads when they ask
        // «why did nobody check the freelance certificate».
        metadata: { step: stepKey, reason },
      });
    });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back(caseId, 'failed');
  }

  revalidatePath(HERE(caseId));
  back(caseId, 'waived');
}

/** Whether the file still has a check nobody has run. */
export async function caseIsOpen(caseId: string): Promise<boolean> {
  const onboarding = await query((tx) => getCase(tx, caseId));
  return onboarding !== null && onboarding.closedAt === null;
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
