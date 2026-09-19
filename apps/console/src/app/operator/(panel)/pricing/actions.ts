'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  NxError,
  addCreditBundle,
  addPlan,
  clearListPrice,
  getPlatformSettings,
  layoutsOf,
  listProductPricing,
  listSectionRequirements,
  operatorCan,
  retireCreditBundle,
  setListPrice,
  setPlanTerms,
  setPlatformSettings,
  setProductOnSale,
  setSectionRequirement,
  setSpecialPrice,
  setTenantDiscount,
  setVatPeriod,
  type CustomerKind,
  type OperatorIdentity,
  type PriceRates,
} from '@nx-verify/core';
import {
  parsePercent,
  parseRateFraction,
  parseRiyals,
  parseWholeNumber,
} from '../../../../components/admin-pricing/model';
import { currentOperator, operatorTransaction } from '../../../../lib/operator';

/**
 * The edits of handoff screen 05, made on the operator connection.
 *
 * Every one of these reads who is signed in and what their role allows, rather than trusting
 * that the screen that rendered the form did: a server action is an endpoint, and an endpoint
 * that assumes its caller came from a particular page is an endpoint with no authorisation.
 *
 * A save runs in one transaction. A price under cost halfway down the table refuses the whole
 * save, so the list is never left half changed, and the screen says which price it was.
 */

const KINDS: readonly CustomerKind[] = ['COMPANY', 'ESTABLISHMENT', 'FREELANCER'];

/** A refusal the screen has words for: a code, and the product it concerns. */
class Refusal extends Error {
  constructor(
    readonly reason: string,
    readonly product?: string,
  ) {
    super(reason);
  }
}

function back(path: string, params: Record<string, string>): never {
  const query = new URLSearchParams(params).toString();
  redirect(query === '' ? path : `${path}?${query}`);
}

async function actorWith(
  permission: 'pricing' | 'settings',
  path: string,
): Promise<OperatorIdentity> {
  const actor = await currentOperator();
  if (!operatorCan(actor.role, permission)) {
    back(path, { refused: 'role' });
  }
  return actor;
}

/** «حفظ التغييرات»: the price table and the verification settings, together. */
export async function savePricingAction(formData: FormData): Promise<void> {
  const path =
    String(formData.get('return_to') ?? '') === 'verification'
      ? '/operator/verification'
      : '/operator/pricing';
  const actor = await currentOperator();
  const pricing = operatorCan(actor.role, 'pricing') && formData.get('prices_present') === '1';
  const settings = operatorCan(actor.role, 'settings') && formData.get('settings_present') === '1';
  if (!pricing && !settings) {
    back(path, { refused: 'role' });
  }

  let thin: string[] = [];
  let cleared: string[] = [];
  try {
    const outcome = await operatorTransaction(async (db) => {
      const thinMargins: string[] = [];
      const clearedPrices: string[] = [];

      if (pricing) {
        const onSale = new Set(formData.getAll('on_sale').map(String));
        for (const product of await listProductPricing(db)) {
          const code = product.productCode;

          /*
           * Three states, not two. A field the form did not carry keeps the price; a field
           * emptied on purpose takes it away; a field with a figure sets it.
           *
           * The empty case did nothing at all, so a price could never be removed, and a check
           * could sit on sale with no price where every run fails at resolvePrice with
           * NX-4041 and nothing on the screen says why.
           */
          const raw = formData.get(`price:${code}`);
          const typed = raw === null ? null : String(raw).trim();
          const wanted =
            product.availability === 'AVAILABLE' ? onSale.has(code) : product.status === 'active';

          const rate = (field: string): number | undefined => {
            const value = formData.get(`${field}:${code}`);
            if (value === null || String(value).trim() === '') {
              return undefined;
            }
            const fraction = parseRateFraction(String(value));
            if (fraction === null) {
              throw new Refusal('rate', code);
            }
            return fraction;
          };
          const rates: Partial<PriceRates> = {};
          const negative = rate('negative');
          const cached = rate('cached');
          if (negative !== undefined) {
            rates.negativePct = negative;
          }
          if (cached !== undefined) {
            rates.cachePct = cached;
          }

          // Off sale first, because a price may not be taken off a check that is on sale, and
          // both can be asked for in the same save.
          if (product.availability === 'AVAILABLE' && !wanted && product.status === 'active') {
            await setProductOnSale(db, actor, code, false);
          }

          const price = typed === null ? product.priceHalalas : typed === '' ? null : parseRiyals(typed);
          if (typed !== null && typed !== '' && (price === null || price <= 0)) {
            throw new Refusal('price', code);
          }
          if (price === null) {
            if (product.priceHalalas !== null) {
              // A check that is not for sale yet may lose its price freely. Only one that a
              // subscriber can actually run needs it.
              if (product.availability === 'AVAILABLE' && wanted) {
                throw new Refusal('clear-on-sale', code);
              }
              await clearListPrice(db, actor, code);
              clearedPrices.push(code);
            }
          } else {
            if (price !== product.priceHalalas && price < product.costHalalas) {
              throw new Refusal('under-cost', code);
            }
            const change = await setListPrice(db, actor, code, price, rates);
            if (change?.thinMargin === true) {
              thinMargins.push(code);
            }
          }

          if (product.availability === 'AVAILABLE' && wanted && product.status !== 'active') {
            if (price === null) {
              throw new Refusal('no-price', code);
            }
            await setProductOnSale(db, actor, code, true);
          }
        }
      }

      if (settings) {
        const change = {
          maxAttempts: parseWholeNumber(String(formData.get('max_attempts') ?? '')),
          resultValidityDays: parseWholeNumber(String(formData.get('result_validity_days') ?? '')),
          nameMatchThresholdPct: parseWholeNumber(
            String(formData.get('name_match_threshold_pct') ?? ''),
          ),
          registryAlertDays: parseWholeNumber(String(formData.get('registry_alert_days') ?? '')),
        };
        if (Object.values(change).some((value) => value === null)) {
          throw new Refusal('settings');
        }
        const values = change as Record<keyof typeof change, number>;
        // Off unless the switch came back on, like every other switch on this screen
        // (ADR-143). A deployment that cannot send mail must be able to turn it off here.
        const userSecondStep =
          formData.get('user_second_step') === 'email' ? ('email' as const) : ('off' as const);
        const text = (key: string): string | null => {
          const value = String(formData.get(key) ?? '').trim();
          return value === '' ? null : value;
        };
        const bank = {
          bankAccountName: text('bank_account_name'),
          bankName: text('bank_name'),
          bankIban: text('bank_iban'),
          transferNote: text('transfer_note'),
        };
        const before = await getPlatformSettings(db);
        if (
          before.maxAttempts !== values.maxAttempts ||
          before.resultValidityDays !== values.resultValidityDays ||
          before.nameMatchThresholdPct !== values.nameMatchThresholdPct ||
          before.registryAlertDays !== values.registryAlertDays ||
          before.userSecondStep !== userSecondStep ||
          before.bankAccountName !== bank.bankAccountName ||
          before.bankName !== bank.bankName ||
          before.bankIban !== bank.bankIban ||
          before.transferNote !== bank.transferNote
        ) {
          await setPlatformSettings(db, actor, { ...values, userSecondStep, ...bank });
        }

        // A switch left off submits nothing, so every section the table lists for a kind is
        // set: required when its switch came back, optional when it did not.
        const layouts = layoutsOf(await listSectionRequirements(db));
        for (const kind of KINDS) {
          const required = new Set(formData.getAll(`required:${kind}`).map(String));
          for (const [section, requirement] of layouts[kind]) {
            if (section === 'REGISTRY' || requirement === 'NOT_APPLICABLE') {
              continue;
            }
            if (formData.get(`listed:${kind}:${section}`) !== '1') {
              continue;
            }
            await setSectionRequirement(db, actor, {
              kind,
              section,
              requirement: required.has(section) ? 'REQUIRED' : 'OPTIONAL',
            });
          }
        }
      }

      return { thinMargins, clearedPrices };
    });
    thin = outcome.thinMargins;
    cleared = outcome.clearedPrices;
  } catch (error) {
    if (error instanceof Refusal) {
      back(path, {
        refused: error.reason,
        ...(error.product === undefined ? {} : { product: error.product }),
      });
    }
    if (error instanceof NxError && error.code === 'NX-4002') {
      // A check whose cost rose past its price refuses every edit to that row, rates included,
      // and the reader deserves the actual reason rather than «تحقق من القيم».
      const underCost = /the price is under the cost of ([A-Z0-9_]+)/.exec(error.message);
      if (underCost !== null) {
        back(path, { refused: 'under-cost', product: underCost[1] ?? '' });
      }
      back(path, {
        refused: /must be a whole number/.test(error.message)
          ? 'settings'
          : /on sale/.test(error.message)
            ? 'clear-on-sale'
            : 'invalid',
      });
    }
    throw error;
  }

  revalidatePath('/operator/pricing');
  revalidatePath('/operator/verification');
  back(path, {
    saved: '1',
    ...(thin.length === 0 ? {} : { thin: thin.join(',') }),
    ...(cleared.length === 0 ? {} : { cleared: cleared.join(',') }),
  });
}

/**
 * «إضافة حزمة», and a replacement only when the dialog said so.
 *
 * A bundle carries the code `BUNDLE_<operations>`, so adding one with a count already on the
 * list used to overwrite it and to put a retired one back on sale, silently. The dialog now
 * sends the code it means to replace, and the domain refuses any other collision.
 */
export async function addBundleAction(formData: FormData): Promise<void> {
  const actor = await actorWith('pricing', '/operator/pricing');
  const operations = parseWholeNumber(String(formData.get('operations') ?? ''));
  const price = parseRiyals(String(formData.get('price') ?? ''));
  const months = parseWholeNumber(String(formData.get('validity_months') ?? '12'));
  const replaces = String(formData.get('replaces') ?? '').trim();
  if (operations === null || price === null || months === null) {
    back('/operator/pricing', { refused: 'invalid' });
  }
  try {
    await operatorTransaction((db) =>
      addCreditBundle(db, actor, {
        operations,
        priceHalalas: price,
        validityMonths: months,
        ...(replaces === '' ? {} : { replaces }),
      }),
    );
  } catch (error) {
    if (error instanceof NxError) {
      if (error.code === 'NX-4091') {
        back('/operator/pricing', { refused: 'bundle-exists' });
      }
      if (error.code === 'NX-4041') {
        back('/operator/pricing', { refused: 'bundle-missing' });
      }
      if (error.code === 'NX-4002') {
        back('/operator/pricing', {
          refused: /under cost/.test(error.message) ? 'bundle-cost' : 'invalid',
        });
      }
    }
    throw error;
  }
  revalidatePath('/operator/pricing');
  back('/operator/pricing', { saved: replaces === '' ? 'bundle' : 'bundle-replaced' });
}

/** Takes a bundle off sale. Operations already bought stay with whoever bought them. */
export async function retireBundleAction(formData: FormData): Promise<void> {
  const actor = await actorWith('pricing', '/operator/pricing');
  const code = String(formData.get('code') ?? '');
  await operatorTransaction((db) => retireCreditBundle(db, actor, code));
  revalidatePath('/operator/pricing');
  back('/operator/pricing', { saved: 'bundle-retired' });
}

/**
 * The terms a plan carries beside its price, read from the dialog's fields.
 *
 * Every one of these was a literal in `addPlan`, and one of them prices work at zero: inside
 * the free re-verification window a repeat check costs the subscriber nothing.
 */
function termsFrom(formData: FormData): {
  termMonths: number;
  freeReverifyDays: number;
  setupFeeHalalas: number;
  commitmentCreditsHalalas: number;
  overageAllowed: boolean;
} | null {
  const termMonths = parseWholeNumber(String(formData.get('term_months') ?? ''));
  const freeReverifyDays = parseWholeNumber(String(formData.get('free_reverify_days') ?? '0'));
  const setupFeeHalalas = parseRiyals(String(formData.get('setup_fee') ?? '0'));
  const commitmentCreditsHalalas = parseRiyals(String(formData.get('commitment_credits') ?? '0'));
  if (
    termMonths === null ||
    freeReverifyDays === null ||
    setupFeeHalalas === null ||
    commitmentCreditsHalalas === null
  ) {
    return null;
  }
  return {
    termMonths,
    freeReverifyDays,
    setupFeeHalalas,
    commitmentCreditsHalalas,
    overageAllowed: String(formData.get('overage_allowed') ?? 'true') === 'true',
  };
}

/** Which refusal a plan write ran into, from the message the domain gave it. */
function planRefusal(error: NxError): string {
  if (error.code === 'NX-4091') {
    return 'plan-exists';
  }
  if (error.code === 'NX-4041') {
    return 'plan-missing';
  }
  if (/under the cost/.test(error.message)) {
    return 'plan-cost';
  }
  return /commitment runs|re-verification window/.test(error.message) ? 'plan-terms' : 'invalid';
}

/** «إضافة باقة»: a monthly plan with every check on sale in it. */
export async function addPlanAction(formData: FormData): Promise<void> {
  const actor = await actorWith('pricing', '/operator/pricing');
  const fee = parseRiyals(String(formData.get('monthly_fee') ?? ''));
  const included = parseWholeNumber(String(formData.get('included') ?? ''));
  const overage = parseRiyals(String(formData.get('overage') ?? ''));
  const terms = termsFrom(formData);
  if (fee === null || included === null || overage === null || terms === null) {
    back('/operator/pricing', { refused: 'invalid' });
  }
  try {
    await operatorTransaction((db) =>
      addPlan(db, actor, {
        code: String(formData.get('code') ?? ''),
        nameAr: String(formData.get('name_ar') ?? ''),
        nameEn: String(formData.get('name_en') ?? ''),
        monthlyFeeHalalas: fee,
        includedTransactions: included,
        overageUnitHalalas: overage,
        ...terms,
      }),
    );
  } catch (error) {
    if (error instanceof NxError) {
      back('/operator/pricing', { refused: planRefusal(error) });
    }
    throw error;
  }
  revalidatePath('/operator/pricing');
  back('/operator/pricing', { saved: 'plan' });
}

/**
 * «شروط الباقة»: the commercial columns of a plan already on sale.
 *
 * The free re-verification window and the stop at the included limit are read live by every
 * commitment, so a change here reaches subscribers who signed months ago. The overage price is
 * not: it was stamped at signing (ADR-168). The notice says both.
 */
export async function setPlanTermsAction(formData: FormData): Promise<void> {
  const actor = await actorWith('pricing', '/operator/pricing');
  const code = String(formData.get('code') ?? '').trim();
  const fee = parseRiyals(String(formData.get('fee') ?? ''));
  const rawIncluded = String(formData.get('included') ?? '').trim();
  const included = rawIncluded === '' ? null : parseWholeNumber(rawIncluded);
  const rawOverage = String(formData.get('overage') ?? '').trim();
  const overage = rawOverage === '' ? null : parseRiyals(rawOverage);
  const terms = termsFrom(formData);
  if (
    code === '' ||
    fee === null ||
    terms === null ||
    (rawIncluded !== '' && included === null) ||
    (rawOverage !== '' && overage === null)
  ) {
    back('/operator/pricing', { refused: 'invalid' });
  }
  try {
    await operatorTransaction((db) =>
      setPlanTerms(db, actor, code, {
        monthlyFeeHalalas: fee,
        includedTransactions: included,
        overageUnitHalalas: overage,
        ...terms,
      }),
    );
  } catch (error) {
    if (error instanceof NxError) {
      back('/operator/pricing', { refused: planRefusal(error) });
    }
    throw error;
  }
  revalidatePath('/operator/pricing');
  back('/operator/pricing', { saved: 'plan-terms' });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «إضافة سعر خاص»: a price for one product, or a discount on all of them, for one subscriber.
 * An empty value lifts what was there and lets the general price decide again.
 */
export async function setSpecialPriceAction(formData: FormData): Promise<void> {
  const actor = await actorWith('pricing', '/operator/pricing');
  const tenantId = String(formData.get('tenant_id') ?? '');
  const discount = String(formData.get('kind') ?? 'product') === 'discount';
  const raw = String(formData.get(discount ? 'discount_pct' : 'price') ?? '').trim();
  const value = raw === '' ? null : discount ? parsePercent(raw) : parseRiyals(raw);
  if (!UUID.test(tenantId) || (raw !== '' && value === null)) {
    back('/operator/pricing', { refused: 'invalid' });
  }

  try {
    await operatorTransaction((db) =>
      discount
        ? setTenantDiscount(db, actor, { tenantId, discountPct: value })
        : setSpecialPrice(db, actor, {
            tenantId,
            productCode: String(formData.get('product_code') ?? ''),
            priceHalalas: value,
          }),
    );
  } catch (error) {
    if (error instanceof NxError && (error.code === 'NX-4002' || error.code === 'NX-4041')) {
      back('/operator/pricing', {
        refused: /under cost/.test(error.message) ? 'special-cost' : 'invalid',
      });
    }
    throw error;
  }
  revalidatePath('/operator/pricing');
  back('/operator/pricing', { saved: 'special' });
}

/**
 * Declares the tax rule from a date (ADR-157).
 *
 * The rate arrives as a percentage because that is how somebody says it, and is stored in
 * basis points because a column holding 0.15 beside one holding 15 is a bug waiting for a
 * quiet afternoon.
 */
export async function setVatAction(formData: FormData): Promise<void> {
  const actor = await actorWith('pricing', '/operator/pricing');
  const effectiveFrom = String(formData.get('effective_from') ?? '').trim();
  const registered = String(formData.get('registered') ?? 'false') === 'true';
  const ratePct = parsePercent(String(formData.get('rate_pct') ?? '').trim());
  const registrationNumber = String(formData.get('registration_number') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();

  if (ratePct === null) {
    back('/operator/pricing', { refused: 'vat-rate' });
  }

  try {
    await operatorTransaction((db) =>
      setVatPeriod(db, actor, {
        effectiveFrom,
        registered,
        rateBps: Math.round(ratePct * 100),
        registrationNumber: registrationNumber === '' ? null : registrationNumber,
        note: note === '' ? null : note,
      }),
    );
  } catch (error) {
    if (error instanceof NxError && (error.code === 'NX-4002' || error.code === 'NX-4003')) {
      back('/operator/pricing', {
        refused: /registration number/.test(error.message)
          ? 'vat-number'
          : /cannot start before/.test(error.message)
            ? 'vat-order'
            : 'vat-rate',
      });
    }
    throw error;
  }
  revalidatePath('/operator/pricing');
  back('/operator/pricing', { saved: 'vat' });
}
