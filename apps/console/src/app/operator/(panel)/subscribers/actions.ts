'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withTenant } from '@nx-verify/db';
import {
  NxError,
  assignSubscriberPlan,
  createSubscriber,
  operatorCan,
  setSubscriberSuspended,
  setTenantModule as setModule,
  setTenantCategoryRisk,
  setTenantRiskBands,
  setTenantRiskSignal,
  type RiskCategory,
} from '@nx-verify/core';
import type { NewSubscriberState } from '../../../../components/admin-subscribers/dialogs';
import { getPool } from '../../../../lib/context';
import {
  currentOperator,
  operatorQuery,
  operatorTransaction,
  requireOperatorPermission,
} from '../../../../lib/operator';

/**
 * Subscribers, changed by the staff whose role allows it: support and owners.
 *
 * Making a subscriber writes its workspace and administrator under its own scope on the
 * application connection and its plan on the operator connection (ADR-118). The temporary
 * password comes back to the dialog that asked, and nowhere else.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refusalAr(error: NxError): string {
  if (error.code === 'NX-4031') {
    return 'دورك في اللوحة لا يسمح بإضافة مشترك.';
  }
  if (error.code === 'NX-4091') {
    return 'لم يُنشأ: يوجد مشترك بمساحة العمل نفسها.';
  }
  if (error.code === 'NX-4041') {
    return 'لم يُنشأ: الباقة المختارة غير معروضة.';
  }
  if (/workspace name/.test(error.message)) {
    return 'لم يُنشأ: اسم مساحة العمل من 3 إلى 40 حرفاً لاتينياً صغيراً أو رقماً أو شرطة.';
  }
  if (/email/.test(error.message)) {
    return 'لم يُنشأ: بريد المسؤول بصيغة غير صحيحة.';
  }
  return 'لم يُنشأ: اسم المنشأة من حرفين إلى 120 حرفاً.';
}

export async function createSubscriberAction(
  _state: NewSubscriberState,
  formData: FormData,
): Promise<NewSubscriberState> {
  const actor = await currentOperator();
  if (!operatorCan(actor.role, 'subscribers')) {
    return { ok: false, messageAr: 'دورك في اللوحة لا يسمح بإضافة مشترك.' };
  }
  try {
    const made = await operatorQuery((db) =>
      createSubscriber((tenantId, handler) => withTenant(getPool(), tenantId, handler), db, actor, {
        legalName: String(formData.get('legal_name') ?? ''),
        slug: String(formData.get('slug') ?? ''),
        adminEmail: String(formData.get('admin_email') ?? ''),
        adminName: String(formData.get('admin_name') ?? ''),
        packageCode: String(formData.get('package_code') ?? ''),
      }),
    );
    revalidatePath('/operator/subscribers');
    return { ok: true, ...made };
  } catch (error) {
    if (error instanceof NxError) {
      return { ok: false, messageAr: refusalAr(error) };
    }
    throw error;
  }
}

function tenantOf(formData: FormData): string {
  const tenantId = String(formData.get('tenant_id') ?? '');
  if (!UUID.test(tenantId)) {
    redirect('/operator/subscribers');
  }
  return tenantId;
}

export async function setSuspendedAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('subscribers');
  const tenantId = tenantOf(formData);
  const suspend = String(formData.get('suspend') ?? '') === '1';
  await operatorTransaction((db) => setSubscriberSuspended(db, actor, tenantId, suspend));
  revalidatePath('/operator/subscribers');
  redirect(`/operator/subscribers/${tenantId}?saved=${suspend ? 'suspended' : 'resumed'}`);
}

export async function assignPlanAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('subscribers');
  const tenantId = tenantOf(formData);
  let refused = false;
  try {
    await operatorTransaction((db) =>
      assignSubscriberPlan(db, actor, tenantId, String(formData.get('package_code') ?? '')),
    );
  } catch (error) {
    if (!(error instanceof NxError)) {
      throw error;
    }
    refused = true;
  }
  revalidatePath('/operator/subscribers');
  redirect(`/operator/subscribers/${tenantId}?${refused ? 'refused=plan' : 'saved=plan'}`);
}

/**
 * Gives one subscriber a module, or takes it away (ADR-137).
 *
 * An empty value lifts the decision rather than turning the module off, which is a different
 * act: it returns them to their plan and the module's own default, and a later change to
 * either reaches them again.
 */
export async function setModuleAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('subscribers');
  const tenantId = tenantOf(formData);
  const raw = String(formData.get('enabled') ?? '');
  const enabled = raw === '' ? null : raw === 'true';
  let refused = false;
  try {
    await operatorTransaction((db) =>
      setModule(
        db,
        { tenantId, moduleCode: String(formData.get('module_code') ?? ''), enabled },
        actor.id,
      ),
    );
  } catch (error) {
    if (!(error instanceof NxError)) {
      throw error;
    }
    refused = true;
  }
  revalidatePath(`/operator/subscribers/${tenantId}`);
  redirect(
    `/operator/subscribers/${tenantId}?${
      refused ? 'refused=module' : enabled === null ? 'saved=module_cleared' : 'saved=module'
    }`,
  );
}

/** A number typed into a field, or null when it was cleared. */
function numberOf(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? '').trim();
  if (raw === '') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * One subscriber's disagreement with the platform's risk model (ADR-138).
 *
 * «رفع التخصيص» is a different act from setting a weight to the platform's number: it removes
 * the row, so a later change to the default reaches them again rather than leaving them frozen
 * at whatever it happened to be today.
 */
export async function setRiskSignalAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('settings');
  const tenantId = tenantOf(formData);
  const clearing = String(formData.get('clear') ?? '') === '1';
  let refused = false;
  try {
    await operatorTransaction((db) =>
      setTenantRiskSignal(
        db,
        {
          tenantId,
          code: String(formData.get('code') ?? ''),
          enabled: clearing ? null : String(formData.get('enabled') ?? 'true') === 'true',
          weight: clearing ? null : numberOf(formData, 'weight'),
          threshold: clearing ? null : numberOf(formData, 'threshold'),
        },
        actor.id,
      ),
    );
  } catch (error) {
    if (!(error instanceof NxError)) {
      throw error;
    }
    refused = true;
  }
  revalidatePath(`/operator/subscribers/${tenantId}`);
  redirect(
    `/operator/subscribers/${tenantId}?${
      refused ? 'refused=risk' : clearing ? 'saved=risk_cleared' : 'saved=risk'
    }`,
  );
}

export async function setRiskBandsAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('settings');
  const tenantId = tenantOf(formData);
  const clearing = String(formData.get('clear') ?? '') === '1';
  let refused = false;
  try {
    await operatorTransaction((db) =>
      setTenantRiskBands(
        db,
        {
          tenantId,
          highFrom: clearing ? null : numberOf(formData, 'high_from'),
          mediumFrom: clearing ? null : numberOf(formData, 'medium_from'),
        },
        actor.id,
      ),
    );
  } catch (error) {
    if (!(error instanceof NxError)) {
      throw error;
    }
    refused = true;
  }
  revalidatePath(`/operator/subscribers/${tenantId}`);
  redirect(
    `/operator/subscribers/${tenantId}?${
      refused ? 'refused=risk' : clearing ? 'saved=risk_cleared' : 'saved=risk'
    }`,
  );
}

/** Stops or resumes a whole kind of doubt for one subscriber (ADR-138). */
export async function setRiskCategoryAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('settings');
  const tenantId = tenantOf(formData);
  // Resuming lifts the exception on every signal of that kind rather than writing «on» over
  // their model, so each returns to inheriting the platform's answer.
  const enabled = String(formData.get('enabled') ?? '') === 'true' ? null : false;
  let refused = false;
  try {
    await operatorTransaction((db) =>
      setTenantCategoryRisk(
        db,
        { tenantId, category: String(formData.get('category') ?? '') as RiskCategory, enabled },
        actor.id,
      ),
    );
  } catch (error) {
    if (!(error instanceof NxError)) {
      throw error;
    }
    refused = true;
  }
  revalidatePath(`/operator/subscribers/${tenantId}`);
  redirect(
    `/operator/subscribers/${tenantId}?${
      refused ? 'refused=risk' : enabled === null ? 'saved=risk_cleared' : 'saved=risk'
    }`,
  );
}
