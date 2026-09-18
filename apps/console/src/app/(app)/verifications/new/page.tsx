import { randomUUID } from 'node:crypto';
import type { ReactElement } from 'react';
import { NoAccess } from '../../../../components/no-access';
import {
  SUBJECT_PROBLEMS_AR,
  customerStandings,
  getPreferences,
  getRequest,
  isSandbox,
  listChecks,
  listDrafts,
  quoteChecks,
  type CustomerKind,
  type CustomerLookup,
} from '@nx-verify/core';
import { VERIFICATION_SANDBOX_CASES } from '@nx-verify/providers';
import { NewRequestScreen } from '../../../../components/new-request';
import type {
  LookupData,
  NewRequestView,
  ProductData,
} from '../../../../components/new-request/model';
import { PageHeader } from '../../../../components/page-header';
import { SectionTabs } from '../../../../components/section-tabs';
import { VERIFICATION_TABS, visible } from '../../../../components/nav';
import { actingUser, query } from '../../../../lib/context';
import { getKeys } from '../../../../lib/keys';
import {
  customerStandingsAction,
  discardDraftAction,
  lookupCustomerAction,
  requestStatusAction,
  saveDraftAction,
  submitRequestAction,
} from './actions';

/** Never prerendered: prices, the balance and the workspace's customers are read per request. */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: Readonly<Record<string, CustomerKind>> = {
  company: 'COMPANY',
  establishment: 'ESTABLISHMENT',
  freelancer: 'FREELANCER',
};

function lookupData(lookup: CustomerLookup): LookupData {
  return {
    ...lookup,
    standings: lookup.standings.map((standing) => ({
      ...standing,
      verifiedAt: standing.verifiedAt?.toISOString() ?? null,
    })),
  };
}

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('verify.run')) {
    return <NoAccess needs="verify.run" />;
  }
  const params = await searchParams;
  const param = (name: string): string | null =>
    typeof params[name] === 'string' ? (params[name] as string) : null;
  const draftId = UUID.test(param('draft') ?? '') ? param('draft') : null;
  const customerId = UUID.test(param('customer') ?? '') ? param('customer') : null;
  const requestedKind = KINDS[param('kind') ?? ''] ?? 'COMPANY';

  const data = await query(async (tx) => {
    // Sequential: one connection, one transaction, one query at a time.
    const keys = getKeys();
    const catalogue = await listChecks(tx);
    const quote = await quoteChecks(
      tx,
      catalogue.map((check) => check.productCode),
    );
    const preferences = await getPreferences(tx);
    const drafts = await listDrafts(tx, keys, 5);
    const sandbox = await isSandbox(tx);
    const opened = draftId === null ? null : await getRequest(tx, keys, draftId);
    const draft = opened?.status === 'DRAFT' ? opened : null;

    const entityId = draft?.entityId ?? customerId;
    const lookup =
      entityId === null
        ? null
        : await customerStandings(tx, keys, entityId, draft?.kind ?? requestedKind);
    return { catalogue, quote, preferences, drafts, sandbox, draft, lookup };
  });

  const priceOf = new Map(data.quote.lines.map((line) => [line.productCode, line]));
  // The first check of each section is ticked when the screen opens. A second check of the
  // same section would ask a second question about the same facts, and a full verification
  // should not pay for one answer twice.
  const sections = new Set<string>();
  const products: ProductData[] = data.catalogue.map((check) => {
    const line = priceOf.get(check.productCode);
    const first = !sections.has(check.section);
    sections.add(check.section);
    return {
      productCode: check.productCode,
      nameAr: check.nameAr,
      nameEn: check.nameEn,
      summaryAr: check.summaryAr,
      appliesTo: check.appliesTo,
      availability: check.availability,
      unitPriceHalalas: line?.unitPriceHalalas ?? null,
      allowed: line?.allowed ?? false,
      refusalAr: line?.refusalAr ?? null,
      perManager: check.requiredInputs.includes('manager_id'),
      needsIban: check.requiredInputs.includes('iban'),
      needsCertificate: check.requiredInputs.includes('certificate_number'),
      selectedByDefault: first,
    };
  });

  const draft = data.draft;
  const kind: CustomerKind = draft?.kind ?? data.lookup?.kind ?? requestedKind;
  let lookup: LookupData | null = data.lookup === null ? null : lookupData(data.lookup);
  if (draft !== null) {
    // A draft for a customer not on file yet has nothing verified, and brings its own IBAN
    // and certificate number, sealed.
    lookup = {
      ...(lookup ?? {
        status: 'NEW',
        entityId: null,
        displayName: null,
        identifier: null,
        kind: null,
        account: null,
        managers: 0,
        hasCertificate: false,
        standings: [],
      }),
    };
    lookup.account = draft.iban ?? lookup.account;
    lookup.hasCertificate = draft.hasCertificate || lookup.hasCertificate;
  }

  const view: NewRequestView = {
    kind,
    products,
    showPrices: data.preferences.showPrices,
    balance: {
      capacityRemaining: data.quote.capacityRemaining,
      walletAvailableHalalas: data.quote.walletAvailableHalalas,
    },
    bundle: randomUUID(),
    lookup,
    draft:
      draft === null
        ? null
        : {
            requestId: draft.requestId,
            kind: draft.kind,
            entityId: draft.entityId,
            label: draft.displayName ?? draft.subject ?? '',
            subject: draft.subject,
            productCodes: draft.productCodes,
            createdAt: draft.createdAt.toISOString(),
            iban: draft.iban,
            hasCertificate: draft.hasCertificate,
          },
    drafts: data.drafts.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
    // A sandbox workspace is offered the numbers its sandbox answers. Production never is.
    samples: data.sandbox
      ? VERIFICATION_SANDBOX_CASES.filter(
          (sample) =>
            sample.productCode === 'CR_FULL' || sample.productCode === 'FREELANCE_CERTIFICATE',
        ).map((sample) => ({
          number: sample.input.split(' + ')[0] ?? sample.input,
          titleAr: sample.titleAr,
          kind: sample.productCode === 'FREELANCE_CERTIFICATE' ? 'FREELANCER' : 'COMPANY',
        }))
      : [],
    problemsAr: SUBJECT_PROBLEMS_AR,
  };

  return (
    <div className="request-screen">
      <SectionTabs tabs={visible(VERIFICATION_TABS, actor.capabilities)} current="/verifications/new" label="أقسام التحقق" />
      <PageHeader
        title="طلب تحقق جديد"
        subtitle="اختر المنتجات ثم اضغط «تحقق من الكل»، أو نفّذ كل منتج على حدة من زره الخاص"
      />
      <NewRequestScreen
        // The address names the draft, and a refresh of the same address keeps the rows.
        key={draftId ?? customerId ?? 'new'}
        view={view}
        actions={{
          lookup: lookupCustomerAction,
          standings: customerStandingsAction,
          submit: submitRequestAction,
          saveDraft: saveDraftAction,
          status: requestStatusAction,
          discardDraft: discardDraftAction,
        }}
      />
    </div>
  );
}
