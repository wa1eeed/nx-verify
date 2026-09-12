'use server';

import { revalidatePath } from 'next/cache';
import { setPackageProduct, setTenantOverride, setTenantPackage } from '@nx-verify/core';
import { operatorQuery, requireOperator } from '../../../../lib/operator';

/**
 * Commercial edits, made on the operator connection.
 *
 * Every one of these re-checks the operator token rather than trusting that the screen
 * that rendered the form did: a server action is an endpoint, and an endpoint that
 * assumes its caller came from a particular page is an endpoint with no authorisation.
 */

export async function setProductAction(formData: FormData): Promise<void> {
  const operatorId = await requireOperator();

  // Riyals on the screen, halalas in the database, integers throughout (ADR-021). An
  // empty field means this plan names no price and the subscriber's price book decides.
  const rawPrice = String(formData.get('unit_price') ?? '').trim();
  const unitPriceHalalas =
    rawPrice === '' ? null : Math.round(Number.parseFloat(rawPrice) * 100);

  await operatorQuery((db) =>
    setPackageProduct(
      db,
      {
        packageCode: String(formData.get('package_code') ?? ''),
        productCode: String(formData.get('product_code') ?? ''),
        enabled: String(formData.get('enabled') ?? 'false') === 'true',
        ...(unitPriceHalalas === null || Number.isNaN(unitPriceHalalas)
          ? {}
          : { unitPriceHalalas }),
      },
      operatorId,
    ),
  );
  revalidatePath('/operator/packages');
}

export async function setOverrideAction(formData: FormData): Promise<void> {
  const operatorId = await requireOperator();
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
  revalidatePath('/operator/packages');
}

export async function assignPackageAction(formData: FormData): Promise<void> {
  const operatorId = await requireOperator();
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
  revalidatePath('/operator/packages');
}
