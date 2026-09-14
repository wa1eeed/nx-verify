import type { ReactElement } from 'react';
import { marginReport } from '@nx-verify/core';
import { OperatorMargin, type MarginRowView } from '../../../../components/operator-margin';
import { operatorQuery, requireOperator } from '../../../../lib/operator';

/**
 * Never prerendered, and it refuses to render without an operator token. It is the only
 * screen in this console that crosses subscribers, and it reads counters rather than runs.
 */
export const dynamic = 'force-dynamic';

export default async function OperatorMarginPage(): Promise<ReactElement> {
  await requireOperator();

  // Names from the catalogue, which is rows rather than code (rule 8), so a check added
  // tomorrow is named here without a release.
  const { rows, names } = await operatorQuery(async (db) => ({
    rows: await marginReport(db),
    names: new Map(
      (
        await db.query<{ code: string; name_ar: string }>(`SELECT code, name_ar FROM products`)
      ).rows.map((product) => [product.code, product.name_ar]),
    ),
  }));

  const view: MarginRowView[] = rows.map((row) => ({
    tenantName: row.tenantName,
    productNameAr: names.get(row.productCode) ?? row.productCode,
    periodStart: row.periodStart,
    runs: row.runs,
    packageRuns: row.packageRuns,
    billedHalalas: row.billedHalalas,
    providerCostHalalas: row.providerCostHalalas,
    grossHalalas: row.grossHalalas,
    marginPct: row.marginPct,
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <OperatorMargin rows={view} />
    </div>
  );
}
