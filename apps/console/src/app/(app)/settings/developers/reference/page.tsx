import type { ReactElement } from 'react';
import { NoAccess } from '../../../../../components/no-access';
import { errorCatalogue, listEntitlements, listProducts, quoteChecks } from '@nx-verify/core';
import { Docs, type DocProductView } from '../../../../../components/docs';
import { actingUser, query } from '../../../../../lib/context';
import { SectionTabs } from '../../../../../components/section-tabs';
import { DEVELOPER_TABS, SETTINGS_TABS, visible } from '../../../../../components/nav';

export const dynamic = 'force-dynamic';

const REFUSAL_LABELS: Record<string, string> = {
  PRODUCT_NOT_IN_PACKAGE:
    'هذه الوحدة غير مشمولة في باقتك. الاشتراك بها يفتحها بلا تغيير في تكاملك.',
  PRODUCT_DISABLED: 'هذه الوحدة معطّلة لمساحة عملك.',
  QUOTA_EXHAUSTED: 'استُنفدت حصة هذه الوحدة لهذه الدورة.',
  CAPACITY_EXHAUSTED: 'استُنفدت سعة الالتزام لهذه المدة.',
  NO_SUBSCRIPTION: 'لا توجد باقة مفعّلة لمساحة العمل هذه.',
  SUBSCRIPTION_INACTIVE: 'اشتراك مساحة العمل غير نشط.',
};

export default async function DocsPage(): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('developers.manage')) {
    return <NoAccess needs="developers.manage" />;
  }
  const view = await query(async (tx) => {
    const [products, entitlements] = await Promise.all([listProducts(tx), listEntitlements(tx)]);
    const standing = new Map(entitlements.map((entry) => [entry.productCode, entry]));
    // What each one costs. The subtitle promised it and the screen showed the inputs alone,
    // and a developer choosing which check to call is choosing on the price (ADR-169).
    const quote = await quoteChecks(
      tx,
      products.map((product) => product.code),
    );
    const priced = new Map(quote.lines.map((line) => [line.productCode, line]));
    const fromPlan = quote.capacityRemaining !== null && quote.capacityRemaining > 0;

    return {
      apiBaseUrl: process.env['NX_API_URL'] ?? 'https://api.nx.sa',
      // Generated from the catalogue, so a module added as rows appears here with the
      // schema it is actually validated against.
      products: products.map((product): DocProductView => {
        const entry = standing.get(product.code);
        return {
          code: product.code,
          nameAr: product.nameAr,
          subjectType: product.subjectType,
          inputSchema: product.inputSchema,
          allowed: entry?.allowed ?? false,
          refusalAr: entry?.refusal ? (REFUSAL_LABELS[entry.refusal] ?? null) : null,
          priceHalalas: priced.get(product.code)?.unitPriceHalalas ?? null,
          coveredByPlan: fromPlan,
        };
      }),
      // Straight from the domain's own catalogue, so a code added there appears here without
      // anybody remembering to write it down twice.
      errors: errorCatalogue().map((row) => ({
        code: row.code,
        status: row.status,
        retryable: row.retryable,
        messageAr: row.messageAr,
      })),
    };
  });

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={visible(SETTINGS_TABS, actor.capabilities)} current="/settings/developers" label="أقسام الإعدادات" />
      <SectionTabs
        tabs={visible(DEVELOPER_TABS, actor.capabilities)}
        current="/settings/developers/reference"
        label="أقسام مفاتيح الربط"
      />
      <Docs view={view} />
    </div>
  );
}
