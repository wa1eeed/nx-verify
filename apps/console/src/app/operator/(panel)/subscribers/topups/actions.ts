'use server';

import { revalidatePath } from 'next/cache';
import { withTenant } from '@nx-verify/db';
import { confirmTopUp, rejectTopUp } from '@nx-verify/core';
import { getPool } from '../../../../../lib/context';
import { requireOperator } from '../../../../../lib/operator';

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
  const operatorId = await requireOperator();

  const requestId = String(formData.get('request_id') ?? '');
  const tenantId = String(formData.get('tenant_id') ?? '');
  const vatInvoiceId = String(formData.get('vat_invoice_id') ?? '').trim();
  if (requestId === '' || tenantId === '' || vatInvoiceId === '') {
    return;
  }

  await withTenant(getPool(), tenantId, (tx) =>
    confirmTopUp(tx, { requestId, vatInvoiceId, settledBy: operatorId }),
  );

  revalidatePath('/operator/subscribers/topups');
}

export async function rejectTopUpAction(formData: FormData): Promise<void> {
  const operatorId = await requireOperator();

  const requestId = String(formData.get('request_id') ?? '');
  const tenantId = String(formData.get('tenant_id') ?? '');
  if (requestId === '' || tenantId === '') {
    return;
  }

  await withTenant(getPool(), tenantId, (tx) =>
    rejectTopUp(tx, { requestId, settledBy: operatorId, note: 'لم تصل الحوالة' }),
  );

  revalidatePath('/operator/subscribers/topups');
}
