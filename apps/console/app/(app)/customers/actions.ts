'use server';

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { runChecks } from '@nx-verify/core';
import { actingUser } from '../../../lib/context';
import { RESULT_COOKIE, type StoredResult } from '../../../lib/check-result';
import { checkDependencies } from '../../../lib/verification';

/**
 * Running the checks a person ticked, from a new customer form or from a customer's file.
 *
 * The form carries a key issued when it was drawn, and every check's idempotency key is
 * derived from it, so pressing twice, refreshing, or going back and pressing again is the
 * same verification and one set of charges (rule 7).
 *
 * What each check did is handed to the next page in a short lived cookie scoped to the
 * customer screens, not in the address: a reference number and a reason are nothing
 * secret, but an address is copied, bookmarked and logged, and this is only true for the
 * next minute.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

function normaliseIban(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export async function startChecksAction(formData: FormData): Promise<void> {
  const user = await actingUser();
  const entityIdRaw = text(formData, 'entity_id');
  const entityId = UUID.test(entityIdRaw) ? entityIdRaw : null;
  const kind = text(formData, 'kind') === 'FREELANCER' ? 'FREELANCER' : 'BUSINESS';
  const bundleRaw = text(formData, 'bundle');
  const bundle = UUID.test(bundleRaw) ? bundleRaw : randomUUID();
  const checks = formData
    .getAll('checks')
    .map((value) => String(value))
    .filter((value) => /^[A-Z][A-Z0-9_]{1,40}$/.test(value));
  const person = text(formData, 'person');

  const unn = text(formData, 'unn');
  const nationalId = text(formData, 'national_id');
  const certificate = text(formData, 'certificate_number').toUpperCase();
  const iban = normaliseIban(text(formData, 'iban'));

  // Where a refused form goes back to, with what was typed kept out of the address.
  const back = (error: string): never => {
    if (entityId) {
      redirect(`/customers/${entityId}?error=${error}`);
    }
    redirect(
      `/customers/new?kind=${kind === 'FREELANCER' ? 'freelancer' : 'business'}&error=${error}`,
    );
  };

  if (checks.length === 0) {
    back('checks');
  }
  if (entityId === null && kind === 'BUSINESS' && !/^7[0-9]{9}$/.test(unn)) {
    back('unn');
  }
  if (
    entityId === null &&
    kind === 'FREELANCER' &&
    (!/^[12][0-9]{9}$/.test(nationalId) || !/^FL-[0-9]{6,12}$/.test(certificate))
  ) {
    back('freelancer');
  }
  if (iban !== '' && !/^SA[0-9]{22}$/.test(iban)) {
    back('iban');
  }

  const result = await runChecks(await checkDependencies(), {
    entityId,
    kind,
    identity:
      entityId !== null
        ? {}
        : kind === 'BUSINESS'
          ? { unn }
          : { nationalId, certificateNumber: certificate },
    productCodes: checks,
    ...(iban === '' ? {} : { inputs: { iban } }),
    bundleKey: bundle,
    requestedBy: user.userId === '' ? null : user.userId,
    ...(UUID.test(person) ? { onlyPeople: [person] } : {}),
  });

  const stored: StoredResult = {
    bundle,
    outcomes: result.outcomes.map((outcome) => ({
      productCode: outcome.productCode,
      status: outcome.status,
      noteAr: outcome.noteAr,
      reference: outcome.reference,
    })),
  };
  (await cookies()).set(RESULT_COOKIE, JSON.stringify(stored), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/customers',
    maxAge: 120,
  });

  if (result.entityId === null) {
    redirect(
      `/customers/new?kind=${kind === 'FREELANCER' ? 'freelancer' : 'business'}&ran=${bundle}`,
    );
  }
  redirect(`/customers/${result.entityId}?ran=${bundle}`);
}
