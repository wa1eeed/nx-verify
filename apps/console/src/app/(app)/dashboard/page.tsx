import type { ReactElement } from 'react';
import { riskDashboard } from '@nx-verify/core';
import { Dashboard } from '../../../components/dashboard';
import { query } from '../../../lib/context';

/**
 * Never prerendered and never cached.
 *
 * This page reads one tenant's live data, and a build machine has no database and no
 * business holding a copy of it. Rendering it at request time is also what keeps a page
 * from showing a snapshot of somebody else's tenant after a deployment.
 */
export const dynamic = 'force-dynamic';

export default async function DashboardPage(): Promise<ReactElement> {
  const view = await query((tx) => riskDashboard(tx));
  return <Dashboard view={view} />;
}
