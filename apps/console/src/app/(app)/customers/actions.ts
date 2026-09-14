'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
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
import type { SectionCheckState } from '../../../components/customer-file/section-live';

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

/** What starting a request from a file came to: its request, or why there is none. */
interface Started {
  entityId: string | null;
  requestId: string | null;
  error: 'checks' | 'iban' | 'failed' | null;
}

async function beginChecks(formData: FormData): Promise<Started> {
  const user = await actingUser();
  const entityIdRaw = text(formData, 'entity_id');
  if (!UUID.test(entityIdRaw)) {
    return { entityId: null, requestId: null, error: 'failed' };
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
    return { entityId, requestId: null, error: 'checks' };
  }
  if (parseSubject(kind, { iban }).problem !== null) {
    return { entityId, requestId: null, error: 'iban' };
  }

  let requestId: string | null = null;
  let failed: 'checks' | 'failed' | null = null;
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
    return { entityId, requestId: null, error: failed ?? 'failed' };
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

  return { entityId, requestId: started, error: null };
}

export async function startChecksAction(formData: FormData): Promise<void> {
  const started = await beginChecks(formData);
  if (started.entityId === null) {
    redirect('/verifications/new');
  }
  if (started.requestId === null) {
    redirect(`/customers/${started.entityId}?error=${started.error ?? 'failed'}`);
  }
  redirect(`/customers/${started.entityId}?request=${started.requestId}`);
}

/**
 * A section's verify, in place: the same request, and the page stays where it is. The file is
 * drawn again in the action's own answer, so the section learns its check is running without a
 * second round trip, and shows its own loader meanwhile.
 */
export async function startSectionChecksAction(
  _previous: SectionCheckState,
  formData: FormData,
): Promise<SectionCheckState> {
  const started = await beginChecks(formData);
  if (started.requestId === null) {
    return { status: 'failed', error: started.error ?? 'failed', at: Date.now() };
  }
  if (started.entityId !== null) {
    revalidatePath(`/customers/${started.entityId}`);
  }
  return { status: 'started', error: null, at: Date.now() };
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
