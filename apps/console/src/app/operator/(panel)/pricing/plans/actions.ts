'use server';

import { revalidatePath } from 'next/cache';
import { NxError, setPackageProduct, setTenantOverride, setTenantPackage } from '@nx-verify/core';
import { redirect } from 'next/navigation';
import {
  parseRiyals,
  parseWholeNumber,
} from '../../../../../components/admin-pricing/model';

/** Back to the screen with a word saying what happened, the way the pricing screen does. */
function back(path: string, params: Record<string, string>): never {
  redirect(`${path}?${new URLSearchParams(params).toString()}`);
}
import { operatorQuery, requireOperatorPermission } from '../../../../../lib/operator';

/**
 * Commercial edits, made on the operator connection.
 *
 * Every one of these re-checks who is signed in and what their role allows, rather than
 * trusting that the screen that rendered the form did: a server action is an endpoint, and an
 * endpoint that assumes its caller came from a particular page is an endpoint with no
 * authorisation.
 */

export async function setProductAction(formData: FormData): Promise<void> {
  const { id: operatorId } = await requireOperatorPermission('pricing');

  /*
   * Riyals on the screen, halalas in the database, integers throughout (ADR-021).
   *
   * Through the shared parser, not `Number.parseFloat`: Arabic-Indic digits, «٣٫٥٠» and
   * «1,250» all yielded NaN, the key was then spread away, and the write went ahead and left
   * the price NULL. A price deleted by typing it correctly in Arabic (ADR-164).
   *
   * A field the form does not carry is not sent at all, so toggling a module no longer erases
   * the plan's price or its monthly quota.
   */
  const rawPrice = String(formData.get('unit_price') ?? '').trim();
  const priceGiven = formData.has('unit_price');
  const unitPriceHalalas = rawPrice === '' ? null : parseRiyals(rawPrice);
  if (priceGiven && rawPrice !== '' && unitPriceHalalas === null) {
    back('/operator/pricing/plans', { refused: 'price' });
  }

  const rawQuota = String(formData.get('monthly_quota') ?? '').trim();
  const quotaGiven = formData.has('monthly_quota');
  const monthlyQuota = rawQuota === '' ? null : parseWholeNumber(rawQuota);
  if (quotaGiven && rawQuota !== '' && monthlyQuota === null) {
    back('/operator/pricing/plans', { refused: 'quota' });
  }

  try {
    await operatorQuery((db) =>
      setPackageProduct(
        db,
        {
          packageCode: String(formData.get('package_code') ?? ''),
          productCode: String(formData.get('product_code') ?? ''),
          enabled: String(formData.get('enabled') ?? 'false') === 'true',
          ...(priceGiven ? { unitPriceHalalas } : {}),
          ...(quotaGiven ? { monthlyQuota } : {}),
        },
        operatorId,
      ),
    );
  } catch (error) {
    if (error instanceof NxError && error.code === 'NX-4002') {
      back('/operator/pricing/plans', {
        refused: /under the cost/.test(error.message) ? 'under-cost' : 'price',
      });
    }
    throw error;
  }
  revalidatePath('/operator/pricing/plans');
  back('/operator/pricing/plans', { saved: 'product' });
}

export async function setOverrideAction(formData: FormData): Promise<void> {
  const { id: operatorId } = await requireOperatorPermission('pricing');
  const raw = String(formData.get('enabled') ?? '');
  // An empty value lifts the exception and lets the plan decide again, which is a
  // different act from turning the module off for this customer.
  const enabled = raw === '' ? null : raw === 'true';

  await operatorQuery((db) =>
    setTenantOverride(
      db,
      {
        tenantId: String(formData.get('tenant_id') ?? ''),
        productCode: String(formData.get('product_code') ?? ''),
        enabled,
      },
      operatorId,
    ),
  );
  revalidatePath('/operator/pricing/plans');
}

export async function assignPackageAction(formData: FormData): Promise<void> {
  const { id: operatorId } = await requireOperatorPermission('subscribers');
  await operatorQuery((db) =>
    setTenantPackage(
      db,
      {
        tenantId: String(formData.get('tenant_id') ?? ''),
        packageCode: String(formData.get('package_code') ?? ''),
      },
      operatorId,
    ),
  );
  revalidatePath('/operator/pricing/plans');
}
