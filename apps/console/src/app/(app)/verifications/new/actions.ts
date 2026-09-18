'use server';

import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import {
  assertCan,
  NxError,
  SUBJECT_PROBLEMS_AR,
  createRequest,
  customerStandings,
  discardDraft,
  executeRequest,
  getRequest,
  lookupCustomer,
  parseSubject,
  refusalFor,
  requestFromDraft,
  submitDraft,
  updateDraft,
  type CustomerKind,
  type CustomerLookup,
  type RequestView,
} from '@nx-verify/core';
import { actingUser, query } from '../../../../lib/context';
import { getKeys } from '../../../../lib/keys';
import { checkDependenciesFor } from '../../../../lib/verification';
import type {
  DraftResult,
  LookupData,
  RequestData,
  RequestField,
  RequestInput,
  RequestResult,
} from '../../../../components/new-request/model';

/**
 * The request screen's calls to the server (handoff screen 02).
 *
 * Pressing «تحقق من الكل» or one product's button creates a request under the key the page
 * was drawn with and answers at once. The checks then run after the response, in the
 * background of this same server, and the screen asks how they are going until each row has
 * settled. The workspace comes from the session, read before the response is sent: the work
 * that carries on after it has no request, and so no cookie, to read it from.
 *
 * Nothing typed travels back. A found customer comes back as a name and masked numbers, and
 * a draft reopens with its number masked, to be run on the server where it is sealed.
 */

const KINDS: ReadonlySet<string> = new Set(['COMPANY', 'ESTABLISHMENT', 'FREELANCER']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z][A-Z0-9_]{1,40}$/;

function kindOf(value: unknown): CustomerKind {
  return typeof value === 'string' && KINDS.has(value) ? (value as CustomerKind) : 'COMPANY';
}

function idOf(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

function codesOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((code): code is string => typeof code === 'string' && CODE.test(code))
    : [];
}

function text(value: unknown, max = 64): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function lookupData(lookup: CustomerLookup): LookupData {
  return {
    ...lookup,
    standings: lookup.standings.map((standing) => ({
      ...standing,
      verifiedAt: standing.verifiedAt?.toISOString() ?? null,
    })),
  };
}

function requestData(view: RequestView): RequestData {
  return {
    requestId: view.requestId,
    status: view.status,
    entityId: view.entityId,
    displayName: view.displayName,
    open: view.open,
    checks: view.checks.map((check) => ({
      productCode: check.productCode,
      status: check.status,
      outcome: check.outcome,
      noteAr: check.noteAr,
    })),
  };
}

/** Who a typed number belongs to, and where each check stands for them. */
export async function lookupCustomerAction(kind: unknown, number: unknown): Promise<LookupData> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'verify.run');
  const lookup = await query((tx) =>
    lookupCustomer(tx, getKeys(), { kind: kindOf(kind), number: text(number, 40) }),
  );
  return lookupData(lookup);
}

/** The same, for a customer already known by their file. */
export async function customerStandingsAction(
  kind: unknown,
  entityId: unknown,
): Promise<LookupData | null> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'verify.run');
  const id = idOf(entityId);
  if (id === null) {
    return null;
  }
  const lookup = await query((tx) => customerStandings(tx, getKeys(), id, kindOf(kind)));
  return lookup === null ? null : lookupData(lookup);
}

function sanitized(input: RequestInput) {
  return {
    kind: kindOf(input.kind),
    number: text(input.number, 40),
    certificateNumber: text(input.certificateNumber, 40),
    iban: text(input.iban, 40),
    entityId: idOf(input.entityId),
    productCodes: codesOf(input.productCodes),
    bundle: UUID.test(text(input.bundle)) ? text(input.bundle) : randomUUID(),
    draftId: idOf(input.draftId),
    mode: input.mode === 'one' ? ('one' as const) : ('all' as const),
  };
}

/** What is wrong with what was typed, before anything is created. */
function problemOf(
  input: ReturnType<typeof sanitized>,
): { errorAr: string; field: RequestField } | null {
  const { problem } = parseSubject(input.kind, {
    // A found customer or a saved draft already has its number: only what was typed is checked.
    number: input.entityId === null && input.draftId === null ? input.number : '',
    certificateNumber: input.certificateNumber,
    iban: input.iban,
  });
  if (problem === null) {
    return null;
  }
  return {
    errorAr: SUBJECT_PROBLEMS_AR[problem],
    field: problem === 'IBAN' ? 'iban' : problem === 'CERTIFICATE' ? 'certificate' : 'number',
  };
}

function failure(error: unknown): { ok: false; errorAr: string; field: RequestField | null } {
  if (error instanceof NxError && error.code === 'NX-4002') {
    const detail = error.message.toLowerCase();
    if (detail.includes('unified number')) {
      return { ok: false, errorAr: SUBJECT_PROBLEMS_AR.REGISTRATION_UNKNOWN, field: 'number' };
    }
    if (detail.includes('no check')) {
      return {
        ok: false,
        errorAr: 'اختر منتجاً واحداً على الأقل ينطبق على هذا العميل.',
        field: null,
      };
    }
  }
  if (error instanceof NxError && error.code === 'NX-4041') {
    return { ok: false, errorAr: 'لم تعد هذه المسودة موجودة.', field: null };
  }
  return { ok: false, errorAr: refusalFor(error), field: null };
}

export async function submitRequestAction(raw: RequestInput): Promise<RequestResult> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'verify.run');
  const user = await actingUser();
  const input = sanitized(raw);
  if (input.productCodes.length === 0) {
    return { ok: false, errorAr: 'اختر منتجاً واحداً على الأقل.', field: null };
  }
  const problem = problemOf(input);
  if (problem !== null) {
    return { ok: false, ...problem };
  }

  const requestedBy = user.userId === '' ? null : user.userId;
  const keys = getKeys();
  let view: RequestView | null;
  try {
    view = await query(async (tx) => {
      const created =
        input.draftId !== null && input.mode === 'all'
          ? await submitDraft(tx, keys, input.draftId, {
              productCodes: input.productCodes,
              iban: input.iban,
              certificateNumber: input.certificateNumber,
            })
          : input.draftId !== null
            ? await requestFromDraft(tx, keys, input.draftId, {
                productCodes: input.productCodes,
                bundleKey: input.bundle,
                requestedBy,
                iban: input.iban,
                certificateNumber: input.certificateNumber,
              })
            : await createRequest(tx, keys, {
                kind: input.kind,
                entityId: input.entityId,
                subject: {
                  number: input.number,
                  certificateNumber: input.certificateNumber,
                  iban: input.iban,
                },
                productCodes: input.productCodes,
                bundleKey: input.bundle,
                requestedBy,
              });
      return getRequest(tx, keys, created.requestId);
    });
  } catch (error) {
    return failure(error);
  }
  if (view === null) {
    return failure(null);
  }

  const requestId = view.requestId;
  const tenantId = user.tenantId;
  after(async () => {
    try {
      await executeRequest(await checkDependenciesFor(tenantId), requestId);
    } catch (error) {
      // The worker's sweep takes it from here. The log says which request, never what was
      // typed for it (rule 4).
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'verification request stopped',
          request_id: requestId,
          code: error instanceof NxError ? error.code : 'NX-5001',
        }),
      );
    }
  });

  return { ok: true, request: requestData(view), nextBundle: randomUUID() };
}

export async function saveDraftAction(raw: RequestInput): Promise<DraftResult> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'verify.run');
  const user = await actingUser();
  const input = sanitized(raw);
  if (input.productCodes.length === 0) {
    return { ok: false, errorAr: 'اختر منتجاً واحداً على الأقل.', field: null };
  }

  const problem = problemOf(input);
  if (problem !== null) {
    return { ok: false, ...problem };
  }

  try {
    if (input.draftId !== null) {
      const draftId = input.draftId;
      const saved = await query((tx) =>
        updateDraft(tx, getKeys(), draftId, {
          productCodes: input.productCodes,
          iban: input.iban,
          certificateNumber: input.certificateNumber,
        }),
      );
      return saved
        ? { ok: true, draftId }
        : { ok: false, errorAr: 'لم تعد هذه المسودة موجودة.', field: null };
    }

    const created = await query((tx) =>
      createRequest(tx, getKeys(), {
        kind: input.kind,
        entityId: input.entityId,
        subject: {
          number: input.number,
          certificateNumber: input.certificateNumber,
          iban: input.iban,
        },
        productCodes: input.productCodes,
        bundleKey: input.bundle,
        requestedBy: user.userId === '' ? null : user.userId,
        draft: true,
      }),
    );
    return { ok: true, draftId: created.requestId };
  } catch (error) {
    return failure(error);
  }
}

/** How a request is going, for the screen that polls it. */
export async function requestStatusAction(requestId: unknown): Promise<RequestData | null> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'customers.read');
  const id = idOf(requestId);
  if (id === null) {
    return null;
  }
  const view = await query((tx) => getRequest(tx, getKeys(), id));
  return view === null ? null : requestData(view);
}

export async function discardDraftAction(draftId: unknown): Promise<boolean> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'verify.run');
  const id = idOf(draftId);
  return id === null ? false : query((tx) => discardDraft(tx, id));
}
