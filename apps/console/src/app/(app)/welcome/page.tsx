import type { ReactElement } from 'react';
import { ownModules } from '@nx-verify/core';
import { Welcome, type WelcomeModuleView } from '../../../components/welcome';
import { query } from '../../../lib/context';
import { toggleOwnModuleAction } from './actions';

/** Never prerendered: one workspace's own choices. */
export const dynamic = 'force-dynamic';

export default async function WelcomePage(): Promise<ReactElement> {
  const data = await query(async (tx) => {
    const modules = await ownModules(tx);
    const { rows } = await tx.query<{ legal_name: string }>(
      `SELECT legal_name FROM tenants WHERE id = $1`,
      [tx.tenantId],
    );
    return { modules, legalName: rows[0]?.legal_name ?? 'منشأتك' };
  });

  const modules: WelcomeModuleView[] = data.modules.map((module) => ({
    code: module.code,
    nameAr: module.nameAr,
    summaryAr: module.summaryAr,
    core: module.core,
    enabled: module.enabled,
    products: module.products,
  }));

  return (
    <Welcome modules={modules} legalName={data.legalName} toggleAction={toggleOwnModuleAction} />
  );
}
