'use server';

import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { redirect } from 'next/navigation';
import {
  NxError,
  createRequest,
  executeRequest,
  findCustomersByIdentifier,
  looksLikeIdentifier,
  openChecksFor,
  parseSubject,
  type CustomerKind,
} from '@nx-verify/core';
import { actingUser, query } from '../../../lib/context';
import { getKeys } from '../../../lib/keys';
import { checkDependenciesFor } from '../../../lib/verification';

/**
 * Verifying from a customer's file: the whole file, one section, or one manager.
 *
 * The same request the request screen makes (handoff screen 02), created under the key the
 * file was drawn with, so pressing twice, refreshing or going back and pressing again is one
 * request and one set of charges (rule 7). It runs in the background, and the file comes back
 * at once with the sections being checked marked «قيد المعالجة»; each one fills as its check
 * settles, without waiting for the rest (README, interactions).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: ReadonlySet<string> = new Set(['COMPANY', 'ESTABLISHMENT', 'FREELANCER']);

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

export async function startChecksAction(formData: FormData): Promise<void> {
  const user = await actingUser();
  const entityIdRaw = text(formData, 'entity_id');
  if (!UUID.test(entityIdRaw)) {
    redirect('/verifications/new');
  }
  const entityId = entityIdRaw;
  const customerKind = text(formData, 'customer_kind');
  const kind: CustomerKind = KINDS.has(customerKind)
    ? (customerKind as CustomerKind)
    : text(formData, 'kind') === 'FREELANCER'
      ? 'FREELANCER'
      : 'COMPANY';
  const bundleRaw = text(formData, 'bundle');
  const bundle = UUID.test(bundleRaw) ? bundleRaw : randomUUID();
  const checks = formData
    .getAll('checks')
    .map((value) => String(value))
    .filter((value) => /^[A-Z][A-Z0-9_]{1,40}$/.test(value));
  const person = text(formData, 'person');
  const iban = text(formData, 'iban');

  if (checks.length === 0) {
    redirect(`/customers/${entityId}?error=checks`);
  }
  if (parseSubject(kind, { iban }).problem !== null) {
    redirect(`/customers/${entityId}?error=iban`);
  }

  let requestId: string | null = null;
  let failed: string | null = null;
  try {
    const created = await query((tx) =>
      createRequest(tx, getKeys(), {
        kind,
        entityId,
        subject: { iban },
        productCodes: checks,
        bundleKey: bundle,
        requestedBy: user.userId === '' ? null : user.userId,
        ...(UUID.test(person) ? { onlyPeople: [person] } : {}),
      }),
    );
    requestId = created.requestId;
  } catch (error) {
    failed = error instanceof NxError && error.code === 'NX-4002' ? 'checks' : 'failed';
  }
  if (requestId === null) {
    redirect(`/customers/${entityId}?error=${failed ?? 'failed'}`);
  }

  const started = requestId;
  const tenantId = user.tenantId;
  after(async () => {
    try {
      await executeRequest(await checkDependenciesFor(tenantId), started);
    } catch (error) {
      // The worker's sweep takes it from here. Which request, never what was in it (rule 4).
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'verification request stopped',
          request_id: started,
          code: error instanceof NxError ? error.code : 'NX-5001',
        }),
      );
    }
  });

  redirect(`/customers/${entityId}?request=${started}`);
}

/** The checks still queued or running for a customer, for the file that waits on them. */
export async function openChecksAction(entityId: unknown): Promise<string[]> {
  if (typeof entityId !== 'string' || !UUID.test(entityId)) {
    return [];
  }
  return query((tx) => openChecksFor(tx, entityId));
}

/**
 * The customers search. A name goes to the address like any filter; a number never does: it
 * is looked up here, by its keyed hash, and the address carries only the files it found.
 */
export async function searchCustomersAction(formData: FormData): Promise<void> {
  const typed = text(formData, 'q').slice(0, 40);
  const kind = text(formData, 'kind');
  const params = new URLSearchParams();
  if (KINDS.has(kind)) {
    params.set('kind', kind);
  }
  if (text(formData, 'alerts') === '1') {
    params.set('alerts', '1');
  }
  if (typed !== '') {
    if (looksLikeIdentifier(typed)) {
      const found = await query((tx) => findCustomersByIdentifier(tx, getKeys(), typed));
      params.set('ids', found.length === 0 ? 'none' : found.slice(0, 20).join(','));
    } else {
      params.set('q', typed);
    }
  }
  const search = params.toString();
  redirect(search === '' ? '/customers' : `/customers?${search}`);
}
