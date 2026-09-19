'use server';

import { revalidatePath } from 'next/cache';
import type { QueryResult, QueryResultRow } from 'pg';
import { withTenant } from '@nx-verify/db';
import {
  NxError,
  createSandboxForRequest,
  refuseSandboxRequest,
  type SandboxProvisioner,
  type SandboxRefusalCode,
} from '@nx-verify/core';
import { getPool } from '../../../../../lib/context';
import {
  operatorQuery,
  operatorTransaction,
  requireOperatorPermission,
} from '../../../../../lib/operator';
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

/** Reads on the operator connection, one statement at a time. */
const operatorReads = {
  query<R extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>> {
    return operatorQuery((db) => db.query<R>(text, values));
  },
};

const provision: SandboxProvisioner = {
  operator: operatorReads,
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
    revalidatePath('/operator/subscribers/sandboxes');
    return { ...NO_SANDBOX_ANSWER, doneAr: 'أُغلق الطلب، ويقرأ المشترك أنه لم يُقبل.' };
  }

  try {
    const made = await createSandboxForRequest(provision, actor, { requestId });
    revalidatePath('/operator/subscribers/sandboxes');
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
