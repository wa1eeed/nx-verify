import type { ReactElement } from 'react';
import { listApiKeys, sandboxLink } from '@nx-verify/core';
import { SANDBOX_TEST_CASES, SCENARIO_NAMES } from '@nx-verify/providers';
import { Developer, type DeveloperView } from '../../../components/developer';
import { query } from '../../../lib/context';

export const dynamic = 'force-dynamic';

export default async function DeveloperPage(): Promise<ReactElement> {
  const view = await query(async (tx): Promise<DeveloperView> => {
    const [workspace, keys] = await Promise.all([sandboxLink(tx), listApiKeys(tx)]);
    const active = keys.find((key) => key.revokedAt === null);

    return {
      isSandbox: workspace.isSandbox,
      apiBaseUrl: process.env['NX_API_URL'] ?? 'https://api.nx.sa',
      keyPrefix: active?.keyPrefix ?? null,
      // Published from the same table the sandbox answers from, so a documented case
      // cannot become one that does not work.
      testCases: SANDBOX_TEST_CASES.map((testCase) => ({
        input: testCase.input,
        productCode: testCase.productCode,
        scenario: testCase.scenario,
        titleAr: testCase.titleAr,
        expectedAr: testCase.expectedAr,
      })),
      scenarioNames: [...SCENARIO_NAMES],
    };
  });

  return <Developer view={view} />;
}
