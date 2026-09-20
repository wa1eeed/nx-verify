import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Queryable } from '@nx-verify/db';
import type { OperatorIdentity } from '@nx-verify/core';

/**
 * Moving a subscriber onto a plan that is no longer sold (ADR-181).
 *
 * `setTenantPackage` writes the commitment from an active plan only and refuses anything else
 * with NX-4041. The action behind the form caught nothing, so the refusal travelled to the
 * panel's error boundary and replaced the whole panel with the error screen, over a choice
 * that is unavailable rather than broken.
 *
 * The screen disables a retired option, and that is the first line rather than the last one:
 * a plan can be retired on another screen after this page was drawn, and a server action is an
 * endpoint that anything may post to. What is pinned here is that the refusal comes back
 * through the notice channel this screen already has, that a move which succeeds clears the
 * word the previous attempt left in the address, and that anything else still travels.
 */

/** What the real `redirect` does: throws, carrying the destination in its digest. */
class Redirected extends Error {
  readonly digest: string;

  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
    this.digest = `NEXT_REDIRECT;replace;${url};307;`;
  }
}

vi.mock('next/navigation', () => ({
  redirect: (url: string): never => {
    throw new Redirected(url);
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const OPERATOR: OperatorIdentity = { id: 'op-1', displayName: 'موظف الدعم', role: 'SUPPORT' };

/**
 * The plan the operator picked, as the database answers about it.
 *
 * Nothing below the domain call is faked: `assignSubscriberPlan` and `setTenantPackage` run
 * for real, and the only thing standing in is the rows Postgres would return. A retired plan
 * is exactly an `INSERT ... SELECT` that matches no row, which is why the refusal can be
 * reproduced without one.
 */
const answers = { planOnSale: true, failsWith: null as Error | null };
const statements: string[] = [];

const db = {
  query: async (text: string): Promise<{ rows: unknown[]; rowCount: number }> => {
    statements.push(text.trim());
    if (answers.failsWith !== null) {
      throw answers.failsWith;
    }
    if (text.includes('INSERT INTO tenant_commitments')) {
      return { rows: [], rowCount: answers.planOnSale ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  },
} as unknown as Queryable;

vi.mock('../src/lib/operator', () => ({
  requireOperatorPermission: async (): Promise<OperatorIdentity> => OPERATOR,
  operatorQuery: async <T,>(handler: (connection: Queryable) => Promise<T>): Promise<T> =>
    handler(db),
}));

import { assignPackageAction } from '../src/app/operator/(panel)/pricing/plans/actions';
import {
  OperatorPackages,
  planNoticeAr,
  type PackageView,
  type SubscriberView,
} from '../src/components/operator-packages';

const noop = async (): Promise<void> => {};

const PLANS: PackageView[] = [
  {
    code: 'GROWTH',
    nameAr: 'النمو',
    billingModel: 'COMMITMENT',
    termMonths: 12,
    includedTransactions: 12_000,
    platformFeeHalalas: 500_000,
    status: 'active',
    products: [],
  },
  {
    code: 'LEGACY_2024',
    nameAr: 'باقة 2024',
    billingModel: 'COMMITMENT',
    termMonths: 12,
    includedTransactions: 5_000,
    platformFeeHalalas: 300_000,
    status: 'retired',
    products: [],
  },
];

const SUBSCRIBER: SubscriberView = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  legalName: 'شركة المثال',
  slug: 'example',
  isSandbox: false,
  packageCode: 'GROWTH',
  includedTransactions: 12_000,
  transactionsUsed: 400,
  overrides: [],
};

const form = (packageCode: string): FormData => {
  const data = new FormData();
  data.set('tenant_id', SUBSCRIBER.tenantId);
  data.set('package_code', packageCode);
  return data;
};

/** Where the action sent the operator, or null if it did not redirect at all. */
const move = async (packageCode: string): Promise<string | null> => {
  statements.length = 0;
  try {
    await assignPackageAction(form(packageCode));
    return null;
  } catch (error) {
    if (error instanceof Redirected) {
      return error.url;
    }
    throw error;
  }
};

describe('a plan that is no longer on sale', () => {
  it('comes back as a notice on the screen, not as the error screen', async () => {
    answers.planOnSale = false;
    answers.failsWith = null;
    expect(await move('LEGACY_2024')).toBe('/operator/pricing/plans?refused=retired');
    // Refused before anything was written: no trail entry for a move that did not happen.
    expect(statements.some((sql) => sql.includes('INSERT INTO operator_audit'))).toBe(false);
  });

  it('says why in its own words, rather than blaming what was typed', () => {
    const notice = planNoticeAr({ refused: 'retired' });
    expect(notice?.tone).toBe('refused');
    expect(notice?.text).toBe('لم يُنقل: هذه الباقة لم تعد معروضة للبيع. اختر باقة سارية.');
    // The catch all says the values were wrong, and nothing was typed here.
    expect(notice?.text).not.toBe(planNoticeAr({ refused: 'anything-else' })?.text);
  });

  it('cannot be chosen on the screen either, though it is named', () => {
    const html = renderToStaticMarkup(
      <OperatorPackages
        notice={null}
        packages={PLANS}
        subscribers={[SUBSCRIBER]}
        allProducts={[{ code: 'CR_FULL', nameAr: 'السجل التجاري' }]}
        setProductAction={noop}
        setOverrideAction={noop}
        assignAction={noop}
      />,
    );
    expect(html).toContain('<option value="LEGACY_2024" disabled=""');
    expect(html).toContain('متقاعدة');
    expect(html).toContain('<option value="GROWTH"');
    expect(html).not.toContain('<option value="GROWTH" disabled=""');
  });
});

describe('a move that goes through', () => {
  it('clears the word the last attempt left in the address', async () => {
    answers.planOnSale = true;
    answers.failsWith = null;
    // Otherwise `revalidatePath` redraws the same URL, and «لم يُنقل» stays on the screen
    // above a move that has just been written.
    expect(await move('GROWTH')).toBe('/operator/pricing/plans?saved=plan');
    expect(planNoticeAr({ saved: 'plan' })).toEqual({
      tone: 'done',
      text: 'نُقل المشترك إلى الباقة الجديدة.',
    });
    // And the trail was written, so the refusal is not the only path this covers.
    expect(statements.some((sql) => sql.includes('INSERT INTO operator_audit'))).toBe(true);
  });

  it('still lets anything that is not a refusal travel to the error screen', async () => {
    answers.planOnSale = true;
    answers.failsWith = new Error('connection terminated');
    await expect(move('GROWTH')).rejects.toThrow('connection terminated');
    answers.failsWith = null;
  });
});
