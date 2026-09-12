import type { ReactElement } from 'react';
import { getCommitment } from '@nx-verify/core';
import { Support, type SupportView } from '../../../components/support';
import { query } from '../../../lib/context';

export const dynamic = 'force-dynamic';

/** What each tier promises. The figures a customer bought, not aspirations. */
const RESPONSE_HOURS: Record<string, number> = {
  STANDARD: 8,
  PRIORITY: 4,
  DEDICATED: 1,
};

export default async function SupportPage(): Promise<ReactElement> {
  const view = await query(async (tx): Promise<SupportView> => {
    const commitment = await getCommitment(tx);
    const tier = commitment?.supportTier ?? null;

    return {
      supportTier: tier,
      packageNameAr: commitment?.packageNameAr ?? null,
      email: process.env['NX_SUPPORT_EMAIL'] ?? 'support@nx.sa',
      responseHours: tier ? (RESPONSE_HOURS[tier] ?? 8) : 8,
    };
  });

  return <Support view={view} />;
}
