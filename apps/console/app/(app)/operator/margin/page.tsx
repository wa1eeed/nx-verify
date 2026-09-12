import type { ReactElement } from 'react';
import { marginReport } from '@nx-verify/core';
import { OperatorMargin, type MarginRowView } from '../../../../components/operator-margin';
import { operatorQuery, requireOperator } from '../../../../lib/operator';

/**
 * Never prerendered, and it refuses to render without an operator token. It is the only
 * screen in this console that crosses subscribers, and it reads counters rather than runs.
 */
export const dynamic = 'force-dynamic';

const PRODUCT_NAMES: Record<string, string> = {
  ADDRESS_ONLY: 'التحقق من العنوان الوطني',
  KYB_COMPLETE: 'التحقق الشامل من المنشأة',
  AOA_ONLY: 'عقد التأسيس',
  MANAGER_PERMISSIONS: 'صلاحيات المدير',
  FREELANCER_CERTIFICATE: 'وثيقة العمل الحر',
  IBAN_OWNERSHIP: 'ملكية الآيبان',
  NAME_MATCH: 'مطابقة الاسم',
  BANK_ACCOUNT_OWNERSHIP: 'تأكيد الحساب البنكي',
  INCOME_VERIFICATION: 'إثبات الدخل',
  PROPERTY_DEED: 'الصك العقاري',
};

export default async function OperatorMarginPage(): Promise<ReactElement> {
  await requireOperator();

  const rows = await operatorQuery((db) => marginReport(db));

  const view: MarginRowView[] = rows.map((row) => ({
    tenantName: row.tenantName,
    productNameAr: PRODUCT_NAMES[row.productCode] ?? row.productCode,
    periodStart: row.periodStart,
    runs: row.runs,
    packageRuns: row.packageRuns,
    billedHalalas: row.billedHalalas,
    providerCostHalalas: row.providerCostHalalas,
    grossHalalas: row.grossHalalas,
    marginPct: row.marginPct,
  }));

  return <OperatorMargin rows={view} />;
}
