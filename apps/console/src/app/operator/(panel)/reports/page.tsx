import type { ReactElement } from 'react';
import { marginTotals, pageMarginReport, type Page } from '@nx-verify/core';
import { OperatorMargin, type MarginRowView } from '../../../../components/operator-margin';
import { operatorOrSignIn, operatorQuery } from '../../../../lib/operator';
import { pageRequestFrom, type SearchParams } from '../../../../lib/pagination';

/**
 * Never prerendered, and it refuses to render without an operator token. It is the only
 * screen in this console that crosses subscribers, and it reads counters rather than runs.
 */
export const dynamic = 'force-dynamic';

export default async function OperatorMarginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<ReactElement> {
  await operatorOrSignIn();
  const params = await searchParams;

  // Names from the catalogue, which is rows rather than code (rule 8), so a check added
  // tomorrow is named here without a release.
  const { report, totals, names } = await operatorQuery(async (db) => ({
    report: await pageMarginReport(db, {}, pageRequestFrom(params)),
    totals: await marginTotals(db),
    names: new Map(
      (
        await db.query<{ code: string; name_ar: string }>(`SELECT code, name_ar FROM products`)
      ).rows.map((product) => [product.code, product.name_ar]),
    ),
  }));

  const view: MarginRowView[] = report.rows.map((row) => ({
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
      <OperatorMargin
        page={{ ...report, rows: view } as Page<MarginRowView>}
        totals={totals}
        params={params}
      />
    </div>
  );
}
