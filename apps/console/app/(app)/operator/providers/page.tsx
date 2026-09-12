import type { ReactElement } from 'react';
import { listCatalog } from '@nx-verify/core';
import {
  OperatorProviders,
  type CatalogRow,
  type OperatorBindingRow,
} from '../../../../components/operator-providers';
import { operatorQuery, requireOperator } from '../../../../lib/operator';

/**
 * Never prerendered and never cached. It also refuses to render at all without an
 * operator token, which is what keeps it out of a subscriber's reach.
 */
export const dynamic = 'force-dynamic';

export default async function OperatorProvidersPage(): Promise<ReactElement> {
  await requireOperator();

  const data = await operatorQuery(async (db) => {
    const catalog = await listCatalog(db);

    const { rows } = await db.query<{
      tenant_id: string;
      legal_name: string;
      slug: string;
      provider: string;
      mode: 'MANAGED' | 'BYOC';
      priority: number;
      endpoints: string[] | null;
      health_status: string;
      activated_at: Date | null;
    }>(
      `SELECT b.tenant_id, t.legal_name, t.slug, b.provider, b.mode, b.priority,
              b.endpoints, b.health_status, b.activated_at
       FROM tenant_provider_binding b
       JOIN tenants t ON t.id = b.tenant_id
       ORDER BY t.legal_name, b.priority, b.provider`,
    );

    return { catalog, rows };
  });

  const catalog: CatalogRow[] = data.catalog.map((entry) => ({
    code: entry.code,
    nameAr: entry.nameAr,
    endpoints: entry.endpoints,
    status: entry.status,
  }));

  const bindings: OperatorBindingRow[] = data.rows.map((row) => ({
    tenantId: row.tenant_id,
    tenantName: row.legal_name,
    slug: row.slug,
    provider: row.provider,
    mode: row.mode,
    priority: row.priority,
    endpoints: row.endpoints,
    healthStatus: row.health_status,
    activated: row.activated_at !== null,
  }));

  return <OperatorProviders catalog={catalog} bindings={bindings} />;
}
