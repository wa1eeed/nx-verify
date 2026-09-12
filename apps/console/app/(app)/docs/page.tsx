import type { ReactElement } from 'react';
import { listEntitlements, listProducts } from '@nx-verify/core';
import { Docs, type DocProductView } from '../../../components/docs';
import { query } from '../../../lib/context';

export const dynamic = 'force-dynamic';

const REFUSAL_LABELS: Record<string, string> = {
  PRODUCT_NOT_IN_PACKAGE: 'هذه الوحدة غير مشمولة في باقتك. الاشتراك بها يفتحها بلا تغيير في تكاملك.',
  PRODUCT_DISABLED: 'هذه الوحدة معطّلة لمساحة عملك.',
  QUOTA_EXHAUSTED: 'استُنفدت حصة هذه الوحدة لهذه الدورة.',
  CAPACITY_EXHAUSTED: 'استُنفدت سعة الالتزام لهذه المدة.',
  NO_SUBSCRIPTION: 'لا توجد باقة مفعّلة لمساحة العمل هذه.',
  SUBSCRIPTION_INACTIVE: 'اشتراك مساحة العمل غير نشط.',
};

export default async function DocsPage(): Promise<ReactElement> {
  const view = await query(async (tx) => {
    const [products, entitlements] = await Promise.all([listProducts(tx), listEntitlements(tx)]);
    const standing = new Map(entitlements.map((entry) => [entry.productCode, entry]));

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
        };
      }),
    };
  });

  return <Docs view={view} />;
}
