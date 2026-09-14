import type { ReactElement } from 'react';
import { homeOverview } from '@nx-verify/core';
import { HomeScreen } from '../../../components/home';
import { query } from '../../../lib/context';
import { getKeys } from '../../../lib/keys';

/**
 * Never prerendered and never cached.
 *
 * This page reads one tenant's live data, and a build machine has no database and no
 * business holding a copy of it. Rendering it at request time is also what keeps a page
 * from showing a snapshot of somebody else's tenant after a deployment.
 */
export const dynamic = 'force-dynamic';

export default async function DashboardPage(): Promise<ReactElement> {
  const now = new Date();
  const overview = await query((tx) => homeOverview(tx, getKeys(), { now }));
  return <HomeScreen overview={overview} now={now} />;
}
