'use server';

import { revalidatePath } from 'next/cache';
import {
  NxError,
  assignSubscriberPlan,
  setPackageProduct,
  setTenantOverride,
} from '@nx-verify/core';
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
  /*
   * Back to the screen without the word the last attempt left in the address.
   *
   * `revalidatePath` alone redraws the same URL, so a `?refused=` from a refused price stayed
   * in it and the refusal was still on the screen above a change that had just been saved. A
   * notice that outlives what it describes is a notice that lies.
   */
  back('/operator/pricing/plans', { saved: 'override' });
}

/**
 * Moves a subscriber onto a plan.
 *
 * Through the same call the subscribers board uses, not through `setTenantPackage` directly:
 * that one writes the subscriber's own trail and nothing else, so a plan changed from this
 * screen appeared in no panel trail at all, while the very same change made two screens away
 * did. One move, one pair of entries, whichever screen it was made from.
 */
export async function assignPackageAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('subscribers');
  try {
    await operatorQuery((db) =>
      assignSubscriberPlan(
        db,
        actor,
        String(formData.get('tenant_id') ?? ''),
        String(formData.get('package_code') ?? ''),
      ),
    );
  } catch (error) {
    /*
     * A plan that is no longer on sale is refused by `setTenantPackage`, and this action
     * caught nothing: the refusal reached the error boundary and the whole panel was replaced
     * by the error screen, over a choice the operator is allowed to make and simply cannot
     * have.
     *
     * The screen disables a retired option, which is the right first line and not the last
     * one: the option is disabled as the page was drawn, and the plan can be retired on
     * another screen a minute later, or the form can arrive without the page at all. A server
     * action is an endpoint. So the refusal comes back as a word in the notice channel this
     * screen already has, and the panel stays where the operator left it.
     */
    if (error instanceof NxError && error.code === 'NX-4041') {
      back('/operator/pricing/plans', { refused: 'retired' });
    }
    throw error;
  }
  revalidatePath('/operator/pricing/plans');
  // And on the way back the address is cleared, so a refusal from the previous attempt is not
  // still on the screen above the move that succeeded.
  back('/operator/pricing/plans', { saved: 'plan' });
}
