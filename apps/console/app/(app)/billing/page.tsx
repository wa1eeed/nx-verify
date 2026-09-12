import type { ReactElement } from 'react';
import { buildStatement, listProducts } from '@nx-verify/core';
import { Statement, type StatementView } from '../../../components/statement';
import { query } from '../../../lib/context';

export const dynamic = 'force-dynamic';

export default async function BillingPage(): Promise<ReactElement> {
  const view = await query(async (tx): Promise<StatementView> => {
    const [statement, products] = await Promise.all([buildStatement(tx), listProducts(tx)]);
    const nameOf = new Map(products.map((product) => [product.code, product.nameAr]));

    return {
      lines: statement.lines.map((line) => ({
        month: line.month,
        productNameAr:
          line.productCode === null ? 'غير محدد' : (nameOf.get(line.productCode) ?? line.productCode),
        runs: line.runs,
        amountHalalas: line.amountHalalas,
      })),
      topUps: statement.topUps,
      spentThisTermHalalas: statement.spentThisTermHalalas,
      extras: statement.extras,
    };
  });

  return <Statement view={view} />;
}
