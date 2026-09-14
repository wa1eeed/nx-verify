import { randomUUID } from 'node:crypto';
import type { ReactElement } from 'react';
import { SECTION_TITLES, checksFor, isSandbox, listChecks, quoteChecks } from '@nx-verify/core';
import { VERIFICATION_SANDBOX_CASES } from '@nx-verify/providers';
import { NewCustomer, type NewCustomerKind } from '../../../../components/new-customer';
import type { CheckOption } from '../../../../components/check-list';
import { query } from '../../../../lib/context';
import { readStoredResult } from '../../../../lib/check-result';
import { startChecksAction } from '../../customers/actions';
import { SectionTabs } from '../../../../components/section-tabs';
import { VERIFICATION_TABS } from '../../../../components/nav';

/** Never prerendered: prices, capacity and the workspace's world are read per request. */
export const dynamic = 'force-dynamic';

const NOTES: Readonly<Record<string, string>> = {
  MANAGER_AUTHORITY: 'عملية لكل مدير يظهر في السجل',
  ARTICLES_OF_ASSOCIATION: 'للشركات فقط',
};

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const kind: NewCustomerKind = params['kind'] === 'freelancer' ? 'freelancer' : 'business';
  const ran = typeof params['ran'] === 'string' ? params['ran'] : null;

  const data = await query(async (tx) => {
    const catalogue = await listChecks(tx);
    const offered = checksFor(catalogue, kind === 'freelancer' ? 'FREELANCER' : 'BUSINESS');
    const quote = await quoteChecks(
      tx,
      offered.map((check) => check.productCode),
    );
    return { catalogue, offered, quote, sandbox: await isSandbox(tx) };
  });

  const priceOf = new Map(data.quote.lines.map((line) => [line.productCode, line]));
  const fromPackage = data.quote.capacityRemaining !== null && data.quote.capacityRemaining > 0;

  const checks: CheckOption[] = data.offered.map((check) => {
    const line = priceOf.get(check.productCode);
    const disabledReasonAr =
      check.availability !== 'AVAILABLE'
        ? 'قريباً'
        : line && !line.allowed
          ? (line.refusalAr ?? 'غير متاحة')
          : null;
    return {
      productCode: check.productCode,
      nameAr: check.nameAr,
      // The section is named only where the check's own name does not already say it.
      sectionAr:
        SECTION_TITLES[check.section] === check.nameAr ? '' : SECTION_TITLES[check.section],
      unitPriceHalalas: line?.unitPriceHalalas ?? null,
      // Everything available is ticked, apart from the account holder's name: it is a second
      // question about the same account, and a full verification should not ask it twice.
      checked: check.productCode !== 'IBAN_BENEFICIARY_NAME',
      disabledReasonAr,
      noteAr: NOTES[check.productCode] ?? null,
    };
  });

  const stored = await readStoredResult(ran);
  const nameOf = new Map(data.catalogue.map((check) => [check.productCode, check.nameAr]));

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <SectionTabs tabs={VERIFICATION_TABS} current="/verifications/new" label="أقسام التحقق" />
      <NewCustomer
        action={startChecksAction}
        view={{
          kind,
          checks,
          fromPackage,
          capacityRemaining: data.quote.capacityRemaining,
          bundle: randomUUID(),
          error: typeof params['error'] === 'string' ? params['error'] : null,
          results: stored
            ? stored.outcomes.map((outcome) => ({
                ...outcome,
                nameAr: nameOf.get(outcome.productCode) ?? outcome.productCode,
              }))
            : null,
          isSandbox: data.sandbox,
          samples: VERIFICATION_SANDBOX_CASES.filter((sample) =>
            kind === 'freelancer'
              ? sample.productCode === 'FREELANCE_CERTIFICATE'
              : sample.productCode === 'CR_FULL',
          ).map((sample) => ({
            input: sample.input,
            titleAr: sample.titleAr,
            expectedAr: sample.expectedAr,
          })),
        }}
      />
    </div>
  );
}
