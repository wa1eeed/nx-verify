import type { ReactElement } from 'react';
import { buildStatement, listProducts, listTopUpRequests } from '@nx-verify/core';
import { Statement, type StatementView } from '../../../../components/statement';
import { TopUpPanel, type TopUpRowView } from '../../../../components/topup';
import { requestTopUpAction } from './topup-actions';
import { query } from '../../../../lib/context';
import { SectionTabs } from '../../../../components/section-tabs';
import { BILLING_TABS } from '../../../../components/nav';

export const dynamic = 'force-dynamic';

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const requests = await query((tx) => listTopUpRequests(tx));

  const view = await query(async (tx): Promise<StatementView> => {
    const [statement, products] = await Promise.all([buildStatement(tx), listProducts(tx)]);
    const nameOf = new Map(products.map((product) => [product.code, product.nameAr]));

    return {
      lines: statement.lines.map((line) => ({
        month: line.month,
        productNameAr:
          line.productCode === null
            ? 'غير محدد'
            : (nameOf.get(line.productCode) ?? line.productCode),
        runs: line.runs,
        amountHalalas: line.amountHalalas,
      })),
      topUps: statement.topUps,
      spentThisTermHalalas: statement.spentThisTermHalalas,
      extras: statement.extras,
    };
  });

  const rows: TopUpRowView[] = requests.map((request) => ({
    id: request.id,
    reference: request.reference,
    amountHalalas: request.amountHalalas,
    totalWithVatHalalas: request.totalWithVatHalalas,
    status: request.status,
    requestedAt: request.requestedAt,
    vatInvoiceId: request.vatInvoiceId,
    note: request.note,
  }));

  const asked = (await searchParams)['topup'];
  const issued =
    typeof asked === 'string' ? (rows.find((row) => row.reference === asked) ?? null) : null;

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={BILLING_TABS} current="/billing/statement" label="أقسام الفوترة" />
      <div className="stack" style={{ gap: 'var(--s-5)' }}>
        <Statement view={view} />
        <TopUpPanel
          requests={rows}
          issued={issued}
          bank={{
            accountName: process.env['NX_BANK_ACCOUNT_NAME'] ?? null,
            bankName: process.env['NX_BANK_NAME'] ?? null,
            iban: process.env['NX_BANK_IBAN'] ?? null,
          }}
          requestAction={requestTopUpAction}
        />
      </div>
    </div>
  );
}
