import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import {
  fieldGroup,
  getCustomerFile,
  getFieldHistory,
  getPreferences,
  getRequest,
  getVerificationHistory,
  listChecks,
  listEntityRuns,
  listProducts,
  listShares,
  openChecksFor,
  quoteChecks,
  valueLabelAr,
  type FieldGroup,
} from '@nx-verify/core';
import { getKeys } from '../../../../lib/keys';
import { query } from '../../../../lib/context';
import { CustomerFileScreen, type TimelineEntry } from '../../../../components/customer-file';
import { SharePanel, type ShareRowView } from '../../../../components/share-panel';
import { fieldLabel, formatValue, type FieldHistoryView } from '../../../../components/field-card';
import { TRIGGER_LABELS } from '../../../../components/verification-history';
import { createShareAction, revokeShareAction } from './share-actions';
import { openChecksAction, startChecksAction, startSectionChecksAction } from '../actions';
import type { CheckResultView } from '../../../../components/check-results';

/**
 * Never prerendered and never cached.
 *
 * This page reads one subscriber's live data, and a build machine has no database and no
 * business holding a copy of it.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RUN_WORDS: Readonly<Record<string, string>> = {
  OK: 'مكتمل',
  PARTIAL: 'مكتمل جزئياً',
  NOT_FOUND: 'لا توجد بيانات',
  ERROR: 'تعذّر',
  AWAITING: 'بانتظار الرد',
  PENDING: 'قيد المعالجة',
};

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const { id } = await params;
  const query_ = await searchParams;
  if (!UUID.test(id)) {
    notFound();
  }
  const now = new Date();

  const data = await query(async (tx) => {
    const file = await getCustomerFile(tx, getKeys(), id, { now });
    if (!file) {
      return null;
    }
    // Sequential: one connection inside one transaction serves one query at a time.
    const histories: Record<string, FieldHistoryView[]> = {};
    for (const section of file.sections) {
      for (const field of section.fields) {
        const history = await getFieldHistory(tx, id, field.fieldPath);
        histories[field.fieldPath] = history
          .filter((entry) => !entry.current)
          .map((entry) => ({
            value: entry.value,
            valueAr: valueLabelAr(field.fieldPath, entry.value) ?? formatValue(entry.value).text,
            authority: entry.authority,
            observedAt: entry.observedAt,
            changed: entry.changed,
          }));
      }
    }
    const quote = await quoteChecks(
      tx,
      file.checks.map((check) => check.productCode),
    );
    const verifications = await getVerificationHistory(tx, id);
    const runs = await listEntityRuns(tx, id);
    const products = await listProducts(tx);
    const shares = await listShares(tx, id);
    const catalogue = await listChecks(tx);
    const running = await openChecksFor(tx, id);
    const preferences = await getPreferences(tx);
    const requestId = typeof query_['request'] === 'string' ? query_['request'] : '';
    const request = UUID.test(requestId) ? await getRequest(tx, getKeys(), requestId) : null;
    return {
      file,
      histories,
      quote,
      verifications,
      runs,
      products,
      shares,
      catalogue,
      running,
      preferences,
      // Only a request about this customer is reported on this customer's file.
      request: request?.entityId === id ? request : null,
    };
  });

  if (!data) {
    notFound();
  }

  // What the request pressed on this file ended in, once every check in it has settled.
  const results: CheckResultView[] | null =
    data.request === null || data.request.open
      ? null
      : data.request.checks.map((check) => ({
          productCode: check.productCode,
          nameAr:
            data.catalogue.find((entry) => entry.productCode === check.productCode)?.nameAr ??
            check.productCode,
          status:
            check.status === 'SKIPPED'
              ? 'SKIPPED'
              : check.outcome === null || check.outcome === 'SKIPPED'
                ? 'ERROR'
                : check.outcome,
          noteAr: check.noteAr,
          reference: check.reference,
        }));
  const nameOf = new Map(data.products.map((product) => [product.code, product.nameAr]));
  const fieldsOf = new Map(data.verifications.map((run) => [run.runId, run.fields]));

  // The record of what was verified when: every run, whatever it ended in, with what the ones
  // that answered wrote, and the day the file was opened at the end.
  const timeline: TimelineEntry[] = [
    ...data.runs.map((run) => ({
      key: run.runId,
      titleAr: `تحقق ${nameOf.get(run.productCode) ?? run.productCode} · ${RUN_WORDS[run.status] ?? run.status}`,
      tone:
        run.status === 'OK' || run.status === 'PARTIAL'
          ? ('done' as const)
          : run.status === 'ERROR'
            ? ('failed' as const)
            : ('neutral' as const),
      at: run.at,
      reference: run.reference,
      triggerAr: TRIGGER_LABELS[run.triggeredBy] ?? null,
      fields: (fieldsOf.get(run.runId) ?? []).map((field) => ({
        fieldPath: field.fieldPath,
        labelAr: fieldLabel(field.fieldPath),
        valueAr: valueLabelAr(field.fieldPath, field.value) ?? formatValue(field.value).text,
        change: field.kind,
      })),
    })),
    {
      key: 'created',
      titleAr: 'إنشاء الملف',
      tone: 'neutral',
      at: data.file.createdAt,
      reference: null,
      triggerAr: null,
      fields: [],
    },
  ];

  // Only the groups this customer has facts in are offered for sharing.
  const availableGroups = [
    ...new Set(
      data.file.sections.flatMap((section) =>
        section.fields.map((field) => fieldGroup(field.fieldPath)),
      ),
    ),
  ] as FieldGroup[];

  const shares: ShareRowView[] = data.shares.map((share) => ({
    shareId: share.shareId,
    groups: share.groups,
    purpose: share.purpose,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    viewCount: share.viewCount,
    lastViewedAt: share.lastViewedAt,
    state: share.state,
  }));

  const issued = query_['share'];
  const issuedLink =
    typeof issued === 'string' && issued !== ''
      ? `${process.env['NX_CONSOLE_BASE_URL'] ?? ''}/p/${issued}`
      : null;

  return (
    <CustomerFileScreen
      action={startChecksAction}
      sectionAction={startSectionChecksAction}
      watch={openChecksAction}
      share={{
        open: issuedLink !== null,
        panel: (
          <SharePanel
            entityId={id}
            availableGroups={availableGroups}
            shares={shares}
            issuedLink={issuedLink}
            createAction={createShareAction}
            revokeAction={revokeShareAction}
            bare
          />
        ),
      }}
      view={{
        file: data.file,
        bundles: {
          refreshAll: randomUUID(),
          sections: Object.fromEntries(
            data.file.sections.map((section) => [section.section, randomUUID()]),
          ),
          managers: Object.fromEntries(
            data.file.managers.map((manager) => [manager.entityId, randomUUID()]),
          ),
        },
        prices: Object.fromEntries(
          data.quote.lines.map((line) => [line.productCode, line.unitPriceHalalas]),
        ),
        refusals: Object.fromEntries(
          data.quote.lines.map((line) => [line.productCode, line.allowed ? null : line.refusalAr]),
        ),
        fromPackage: data.quote.capacityRemaining !== null && data.quote.capacityRemaining > 0,
        showPrices: data.preferences.showPrices,
        results,
        running: data.running,
        error: typeof query_['error'] === 'string' ? query_['error'] : null,
        histories: data.histories,
        timeline,
        now,
      }}
    />
  );
}
