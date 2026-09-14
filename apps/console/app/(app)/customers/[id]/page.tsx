import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import {
  fieldGroup,
  getCustomerFile,
  getFieldHistory,
  getVerificationHistory,
  listChecks,
  listProducts,
  listShares,
  quoteChecks,
  type FieldGroup,
} from '@nx-verify/core';
import { getKeys } from '../../../../lib/keys';
import { query } from '../../../../lib/context';
import { readStoredResult } from '../../../../lib/check-result';
import { CustomerFileScreen } from '../../../../components/customer-file';
import { SharePanel, type ShareRowView } from '../../../../components/share-panel';
import {
  VerificationHistory,
  type VerificationHistoryEntry,
} from '../../../../components/verification-history';
import type { FieldHistoryView } from '../../../../components/field-card';
import { createShareAction, revokeShareAction } from './share-actions';
import { startChecksAction } from '../actions';

/**
 * Never prerendered and never cached.
 *
 * This page reads one subscriber's live data, and a build machine has no database and no
 * business holding a copy of it.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
          .map((entry) => ({ value: entry.value, authority: entry.authority, observedAt: entry.observedAt, changed: entry.changed }));
      }
    }
    const quote = await quoteChecks(tx, file.checks.map((check) => check.productCode));
    const verifications = await getVerificationHistory(tx, id);
    const products = await listProducts(tx);
    const shares = await listShares(tx, id);
    const catalogue = await listChecks(tx);
    return { file, histories, quote, verifications, products, shares, catalogue };
  });

  if (!data) {
    notFound();
  }

  const ran = typeof query_['ran'] === 'string' ? query_['ran'] : null;
  const stored = await readStoredResult(ran);
  const nameOf = new Map(data.products.map((product) => [product.code, product.nameAr]));

  const verifications: VerificationHistoryEntry[] = data.verifications.map((run) => ({
    runId: run.runId,
    reference: run.reference,
    productNameAr: nameOf.get(run.productCode) ?? run.productCode,
    at: run.at,
    decision: run.decision,
    triggeredBy: run.triggeredBy,
    fields: run.fields,
  }));

  // Only the groups this customer has facts in are offered for sharing.
  const availableGroups = [
    ...new Set(data.file.sections.flatMap((section) => section.fields.map((field) => fieldGroup(field.fieldPath)))),
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
    typeof issued === 'string' && issued !== '' ? `${process.env['NX_CONSOLE_BASE_URL'] ?? ''}/p/${issued}` : null;

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <nav className="muted" aria-label="مسار الصفحة">
        <a href="/customers">العملاء</a> / {data.file.displayName ?? 'عميل'}
      </nav>
      <CustomerFileScreen
        action={startChecksAction}
        view={{
          file: data.file,
          bundles: {
            checklist: randomUUID(),
            sections: Object.fromEntries(data.file.sections.map((section) => [section.section, randomUUID()])),
            managers: Object.fromEntries(data.file.managers.map((manager) => [manager.entityId, randomUUID()])),
          },
          prices: Object.fromEntries(data.quote.lines.map((line) => [line.productCode, line.unitPriceHalalas])),
          refusals: Object.fromEntries(data.quote.lines.map((line) => [line.productCode, line.allowed ? null : line.refusalAr])),
          fromPackage: data.quote.capacityRemaining !== null && data.quote.capacityRemaining > 0,
          capacityRemaining: data.quote.capacityRemaining,
          results: stored
            ? stored.outcomes.map((outcome) => ({
                ...outcome,
                nameAr: data.catalogue.find((check) => check.productCode === outcome.productCode)?.nameAr ?? outcome.productCode,
              }))
            : null,
          error: typeof query_['error'] === 'string' ? query_['error'] : null,
          histories: data.histories,
          now,
        }}
      />
      <VerificationHistory entries={verifications} />
      <SharePanel
        entityId={id}
        availableGroups={availableGroups}
        shares={shares}
        issuedLink={issuedLink}
        createAction={createShareAction}
        revokeAction={revokeShareAction}
      />
    </div>
  );
}
