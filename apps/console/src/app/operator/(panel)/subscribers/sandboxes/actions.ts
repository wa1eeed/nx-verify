'use server';

import { revalidatePath } from 'next/cache';
import { withTenant } from '@nx-verify/db';
import {
  NxError,
  createSandboxForRequest,
  refuseSandboxRequest,
  type SandboxProvisioner,
  type SandboxRefusalCode,
} from '@nx-verify/core';
import { getPool } from '../../../../../lib/context';
import { operatorTransaction, requireOperatorPermission } from '../../../../../lib/operator';
import {
  NO_SANDBOX_ANSWER,
  type SandboxAnswerState,
} from '../../../../../components/sandbox-access';

/**
 * Answering an ask for a sandbox (ADR-173).
 *
 * Two connections, for the reason `confirmTopUpAction` needs two. The operator role may link a
 * workspace to the one it is the sandbox of and put it on a plan, and may do nothing else to a
 * subscriber's data. Inserting the workspace, making the person who signs in to it and funding
 * its wallet are writes to a subscriber's own tables, which belong on the application
 * connection under that workspace's own row level security.
 *
 * The first password comes back in the result of the action rather than in the address, so it
 * reaches the screen that asked and no browser history, referrer or proxy log on the way
 * (SEC-10).
 */

/**
 * The two connections, and nothing beside them.
 *
 * There was a pooled operator reader here as well, for the read that chose which ask was being
 * answered. It is gone because that read belongs inside the transaction that answers: it takes
 * the row with FOR UPDATE, so a second member of staff answering the same ask waits rather than
 * racing, and no workspace is ever made for an ask that was closed while it was being made.
 */
const provision: SandboxProvisioner = {
  inOperatorTransaction: (run) => operatorTransaction(run),
  inTenant: (tenantId, run) => withTenant(getPool(), tenantId, run),
};

function isRefusalCode(value: string): value is SandboxRefusalCode {
  return value === 'HAS_SANDBOX' || value === 'NOT_ELIGIBLE';
}

export async function answerSandboxAction(
  _previous: SandboxAnswerState,
  formData: FormData,
): Promise<SandboxAnswerState> {
  const actor = await requireOperatorPermission('subscribers');

  const requestId = String(formData.get('request_id') ?? '');
  const intent = String(formData.get('intent') ?? '');
  if (requestId === '') {
    return { ...NO_SANDBOX_ANSWER, refusalAr: 'لم يُحدَّد الطلب.' };
  }

  if (intent === 'refuse') {
    const reason = String(formData.get('reason') ?? '');
    if (!isRefusalCode(reason)) {
      return { ...NO_SANDBOX_ANSWER, refusalAr: 'لم يُحدَّد سبب الإغلاق.' };
    }
    try {
      await operatorTransaction((db) =>
        refuseSandboxRequest(db, actor, { requestId, code: reason }),
      );
    } catch (error) {
      return { ...NO_SANDBOX_ANSWER, refusalAr: refusalAr(error) };
    }
    answered();
    return { ...NO_SANDBOX_ANSWER, doneAr: 'أُغلق الطلب، ويقرأ المشترك أنه لم يُقبل.' };
  }

  try {
    const made = await createSandboxForRequest(provision, actor, { requestId });
    answered();
    return {
      made: {
        legalName: made.legalName,
        slug: made.slug,
        email: made.account?.email ?? null,
        temporaryPassword: made.account?.temporaryPassword ?? null,
      },
      doneAr: null,
      refusalAr: null,
    };
  } catch (error) {
    return { ...NO_SANDBOX_ANSWER, refusalAr: refusalAr(error) };
  }
}

/**
 * What an answer changes on the screens.
 *
 * The queue, and the frame around it. The number of asks waiting is drawn beside «المشتركون»
 * in the panel's navigation, which lives in the layout, so revalidating the page on its own
 * asks for the half that was already in front of the person who pressed.
 *
 * Two paths, because one of them is not enough. The queue's own path with `layout` redraws
 * the screen that was pressed on, frame included. The panel's root with `layout` reaches every
 * other panel screen, whose copy of that frame the router keeps from before this press: an
 * answer given here would otherwise leave «المشتركون» claiming an ask that no longer waits
 * for as long as that copy is reused.
 *
 * What neither can do is make the number arrive without a press. The panel's layout is not
 * re-executed as a member of staff moves between its screens, so the count is as fresh as the
 * last time the frame itself was drawn: it reaches somebody opening the panel, and it does not
 * reach somebody who has been sitting in it. A number that has to arrive on its own is a
 * different mechanism, and this is not it.
 */
function answered(): void {
  revalidatePath('/operator/subscribers/sandboxes', 'layout');
  revalidatePath('/operator', 'layout');
}

/**
 * Why nothing happened, in Arabic.
 *
 * Anything that is not one of ours is rethrown: a screen that turns an unknown failure into a
 * polite sentence is a screen that hides a fault until somebody's sandbox is half made.
 */
function refusalAr(error: unknown): string {
  if (!(error instanceof NxError)) {
    throw error;
  }
  switch (error.code) {
    case 'NX-4031':
      return 'دورك لا يغيّر المشتركين.';
    case 'NX-4041':
      return 'لم يعد هذا الطلب مفتوحاً.';
    case 'NX-4091':
      return 'لم تُنشأ المساحة: لمساحة عمل هذا المشترك مساحة اختبار بالفعل، أو أجاب أحد على الطلب قبل قليل.';
    case 'NX-5001':
      // Said as what it is. The two sentences above name causes a member of staff can act on;
      // this one names none, because it is a state of the database rather than a state of the
      // request, and telling them «لديه مساحة بالفعل» would send them to look for one.
      return 'لم تُنشأ المساحة: تعذّر تجهيزها في هذا النشر. أبلغ الهندسة بالطلب ولا تعِد المحاولة.';
    default:
      throw error;
  }
}
