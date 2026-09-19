'use server';

import { revalidatePath } from 'next/cache';
import { withTenant } from '@nx-verify/db';
import { NxError, confirmTopUp, rejectTopUp } from '@nx-verify/core';
import { redirect } from 'next/navigation';
import { getPool } from '../../../../../lib/context';
import { requireOperatorPermission } from '../../../../../lib/operator';

/**
 * Settling a transfer.
 *
 * Run with the subscriber in scope on the application connection, not on the operator
 * one. Moving a balance is writing a subscriber's own data, and nx_operator is not
 * allowed to do that: it crosses subscribers to read and to configure, and giving it the
 * wallet would make every other limit on it decorative.
 *
 * The tenant comes from the row the operator is acting on, which is why the form carries
 * it and why the operator token is checked before anything reads it.
 */

export async function confirmTopUpAction(formData: FormData): Promise<void> {
  const { id: operatorId } = await requireOperatorPermission('subscribers');

  const requestId = String(formData.get('request_id') ?? '');
  const tenantId = String(formData.get('tenant_id') ?? '');
  const vatInvoiceId = String(formData.get('vat_invoice_id') ?? '').trim();
  if (requestId === '' || tenantId === '') {
    back({ refused: 'invalid' });
  }

  /*
   * It used to return silently on an empty invoice number, so the row simply sat there and
   * nothing on the screen said why. And the invoice is only required while the platform is
   * registered for VAT: demanding one on an unregistered platform made staff invent a number
   * for an invoice that does not exist (ADR-166). The core decides which applies; this just
   * reports the refusal instead of swallowing it.
   */
  try {
    await withTenant(getPool(), tenantId, (tx) =>
      confirmTopUp(tx, { requestId, vatInvoiceId, settledBy: operatorId }),
    );
  } catch (error) {
    if (error instanceof NxError) {
      if (error.code === 'NX-4001') {
        back({ refused: 'invoice' });
      }
      if (error.code === 'NX-4091') {
        back({ refused: 'settled' });
      }
    }
    throw error;
  }

  revalidatePath('/operator/subscribers/topups');
  back({ saved: 'confirmed' });
}

export async function rejectTopUpAction(formData: FormData): Promise<void> {
  const { id: operatorId } = await requireOperatorPermission('subscribers');

  const requestId = String(formData.get('request_id') ?? '');
  const tenantId = String(formData.get('tenant_id') ?? '');
  if (requestId === '' || tenantId === '') {
    back({ refused: 'invalid' });
  }

  await withTenant(getPool(), tenantId, (tx) =>
    rejectTopUp(tx, { requestId, settledBy: operatorId, note: 'لم تصل الحوالة' }),
  );

  revalidatePath('/operator/subscribers/topups');
  back({ saved: 'rejected' });
}

function back(params: Record<string, string>): never {
  redirect(`/operator/subscribers/topups?${new URLSearchParams(params).toString()}`);
}
