import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { withTenant } from '../../../packages/db/src/client';
import { verify } from '../../../packages/core/src/verification/verify';
import { createPortfolio } from '../../../packages/core/src/portfolios/portfolios';
import { createUser } from '../../../packages/core/src/auth/users';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing';
import {
  Portfolios,
  portfolioNotice,
  type PortfolioMemberView,
  type PortfolioRowView,
} from '../src/components/portfolios';

/**
 * Putting a customer in a group from the console (ADR-176).
 *
 * `portfolio_members` had one writer, reachable only from the API endpoint
 * `POST /v1/portfolios/:id/members`, so the groups screen promised three things it had no way
 * to do: grouping, a policy for new members, and automatic monitoring.
 * The half of this file that talks to Postgres pins the loop end to end, because a screen
 * that renders a member nobody can add is the failure it is here to prevent; the half that
 * renders the component alone pins what the screen says when it cannot do the thing.
 */

// The action redirects with an outcome, which is how this screen reports. `revalidatePath`
// is the only piece that needs a request it does not have here.
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const outcomeOf = async (action: Promise<void>): Promise<string> => {
  try {
    await action;
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? '';
    return /outcome=([a-z_]+)/.exec(digest)?.[1] ?? `no outcome in ${digest}`;
  }
  return 'no redirect';
};

const form = (portfolioId: string, entityId: string): FormData => {
  const data = new FormData();
  data.set('portfolio_id', portfolioId);
  data.set('entity_id', entityId);
  return data;
};

describe('a customer joins a group and leaves it', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let entityId: string;
  let watched: string;
  let plain: string;
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'شركة المثال للتجارة');
    await preparePricedTenant(db, tenant.tenantId, { balanceHalalas: 5_000_00 });

    const result = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'KYB_COMPLETE',
        subject: { unn: '7001272184', manager: { id: '1098765432', id_type: 'NATIONAL_ID' } },
        subjectIdentifiers: [{ idType: 'UNN', value: '7001272184' }],
        subjectDisplayName: 'شركة المثال للتجارة',
        triggeredBy: 'CONSOLE',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );
    entityId = result.entityId ?? '';

    const prepared = await withTenant(db.appPool, tenant.tenantId, async (tx) => ({
      userId: await createUser(tx, {
        email: 'risk@example.sa',
        displayName: 'مسؤولة المخاطر',
        role: 'ADMIN',
      }),
      watched: await createPortfolio(tx, {
        code: 'GOV_SUPPLIERS',
        nameAr: 'موردو القطاع الحكومي',
        nameEn: 'Gov suppliers',
        defaultProductCode: 'KYB_COMPLETE',
        monitorByDefault: true,
        monitorCadence: 'WEEKLY',
        monitorBudget: 300_00,
      }),
      plain: await createPortfolio(tx, {
        code: 'ARCHIVE',
        nameAr: 'مجموعة الأرشيف',
        nameEn: 'Archive',
      }),
    }));
    watched = prepared.watched;
    plain = prepared.plain;

    process.env['NX_APP_DATABASE_URL'] = db.appConnectionString;
    process.env['NX_CONSOLE_TENANT_ID'] = tenant.tenantId;
    process.env['NX_CONSOLE_USER_ID'] = prepared.userId;
    process.env['NX_MASTER_KEY'] = Buffer.alloc(32, 7).toString('base64');
  });

  afterAll(async () => {
    delete process.env['NX_CONSOLE_USER_ID'];
    const { closePool } = await import('../src/lib/context');
    const { closeSessionPool } = await import('../src/lib/session');
    await closePool();
    await closeSessionPool();
    await db.close();
  });

  const screen = async (): Promise<string> => {
    const { default: PortfoliosPage } = await import('../src/app/(app)/settings/portfolios/page');
    return renderToStaticMarkup(await PortfoliosPage({ searchParams: Promise.resolve({}) }));
  };

  it('offers this workspace customers to pick from, and nothing to remove yet', async () => {
    const html = await screen();

    expect(html).toContain('data-role="add-member"');
    expect(html).toContain('name="entity_id"');
    expect(html).toContain(`value="${entityId}"`);
    // Customers, not entities. A manager met inside a company check is a row in `entities`
    // with no name, and the workspace's own record is another: neither is a customer, and
    // putting one in a watching group would monitor a company product against a person.
    expect(html).not.toContain('عميل بلا اسم');
    expect(html).not.toContain(`value="${tenant.entityId}"`);
    // The count column reads the members table, and until something writes to it the honest
    // answer is that there are none.
    expect(html).not.toContain('data-role="portfolio-member"');
    expect(html).toContain('مجموعة بلا أعضاء سياسةٌ لا تنطبق على أحد');
  });

  it('adds the customer and starts the monitoring the group promised', async () => {
    const { addMemberAction } = await import('../src/app/(app)/settings/portfolios/actions');

    expect(await outcomeOf(addMemberAction(form(watched, entityId)))).toBe('member_watched');

    // ADR-167 built this inside `addToPortfolio`, where only an API caller reached it.
    const monitors = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const { rows } = await tx.query<{ status: string; activated_by: string }>(
        `SELECT status, activated_by FROM monitors
         WHERE tenant_id = $1 AND consent_ref = $2`,
        [tx.tenantId, `portfolio:${watched}`],
      );
      return rows;
    });
    expect(monitors).toHaveLength(1);
    expect(monitors[0]?.status).toBe('active');
    // Monitoring is never anonymous, and the name on it is the person who pressed the button.
    expect(monitors[0]?.activated_by).toBe(process.env['NX_CONSOLE_USER_ID']);

    const html = await screen();
    expect(html).toContain('data-role="portfolio-member"');
    expect(html).toContain(`data-portfolio="${watched}"`);
    expect(html).toContain('شركة المثال للتجارة');
    expect(html).toContain('مسؤولة المخاطر');
    // The word the monitoring screen uses for the same state, so one thing has one name.
    expect(html).toContain('تعمل');
  });

  it('refuses the same customer twice rather than reporting a second add', async () => {
    const { addMemberAction } = await import('../src/app/(app)/settings/portfolios/actions');
    expect(await outcomeOf(addMemberAction(form(watched, entityId)))).toBe('member_exists');
  });

  it('says a group that watches nobody started nothing', async () => {
    const { addMemberAction } = await import('../src/app/(app)/settings/portfolios/actions');
    expect(await outcomeOf(addMemberAction(form(plain, entityId)))).toBe('member_added');
  });

  it('counts the member on the group it belongs to', async () => {
    const html = await screen();
    // The count column used to read a table no console screen could write to, so it was zero
    // for every subscriber who did not call the API themselves.
    expect(html).toMatch(/موردو القطاع الحكومي[\s\S]*?>1</);
  });

  it('stops the monitoring when the customer is taken out', async () => {
    const { removeMemberAction } = await import('../src/app/(app)/settings/portfolios/actions');

    expect(await outcomeOf(removeMemberAction(form(watched, entityId)))).toBe(
      'member_removed_stopped',
    );

    const status = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM monitors WHERE tenant_id = $1 AND consent_ref = $2`,
        [tx.tenantId, `portfolio:${watched}`],
      );
      return rows[0]?.status;
    });
    expect(status).toBe('paused');

    // The other membership is untouched: one act, one group.
    const html = await screen();
    expect(html).toContain(`data-portfolio="${plain}"`);
    expect(html).not.toContain(`data-portfolio="${watched}"`);
  });

  it('reports a removal that removed nothing as exactly that', async () => {
    const { removeMemberAction } = await import('../src/app/(app)/settings/portfolios/actions');
    expect(await outcomeOf(removeMemberAction(form(watched, entityId)))).toBe('member_gone');
  });

  it('names no data provider anywhere on the screen', async () => {
    expect(await screen()).not.toContain('wathq-example-connector');
  });
});

const noop = async (): Promise<void> => {};

const group = (over: Partial<PortfolioRowView> = {}): PortfolioRowView => ({
  portfolioId: 'p1',
  code: 'GOV',
  nameAr: 'موردو القطاع الحكومي',
  entities: 1,
  withExpired: 0,
  openCases: 0,
  monitorByDefault: true,
  monitorBudget: 300_00,
  monitorCadence: 'WEEKLY',
  decisionRuleset: null,
  defaultProductCode: 'KYB_COMPLETE',
  ...over,
});

const member = (over: Partial<PortfolioMemberView> = {}): PortfolioMemberView => ({
  portfolioId: 'p1',
  entityId: 'e1',
  displayName: 'شركة المثال للتجارة',
  addedByName: 'مسؤولة المخاطر',
  addedAt: new Date('2026-09-18T09:00:00Z'),
  monitorStatus: 'active',
  ...over,
});

describe('what the screen says when it cannot change a membership', () => {
  it('offers no form and says why, for somebody who may not see customers', () => {
    const html = renderToStaticMarkup(
      <Portfolios rows={[group()]} members={[member()]} createAction={noop} />,
    );

    expect(html).not.toContain('data-role="add-member"');
    expect(html).not.toContain('data-role="remove-member"');
    expect(html).toContain('data-role="members-read-only"');
    expect(html).toContain('عرض العملاء');
  });

  it('tells somebody who may not read the memberships that it did not look', () => {
    const html = renderToStaticMarkup(<Portfolios rows={[group()]} createAction={noop} />);

    expect(html).toContain('data-role="members-read-only"');
    // The page reads no membership for this person, so an empty table here is not news
    // about the groups, and «لا أعضاء بعد» would be a count they were not allowed to take.
    expect(html).not.toContain('لا أعضاء بعد');
    expect(html).not.toContain('0 عضواً');
  });

  it('says the member table is showing a slice when it is', () => {
    const html = renderToStaticMarkup(
      <Portfolios
        rows={[group()]}
        members={[member()]}
        memberTotal={620}
        addMemberAction={noop}
        removeMemberAction={noop}
        candidates={[{ entityId: 'e1', displayName: 'شركة المثال' }]}
        candidateTotal={1}
      />,
    );

    // The heading counts every membership, not the ones that fitted on the screen.
    expect(html).toContain('620 عضواً');
    expect(html).toContain('data-role="member-cap"');
  });

  it('says the picker is showing a slice when it is', () => {
    const html = renderToStaticMarkup(
      <Portfolios
        rows={[group()]}
        members={[]}
        candidates={[{ entityId: 'e1', displayName: 'شركة المثال' }]}
        candidateTotal={940}
        addMemberAction={noop}
        removeMemberAction={noop}
      />,
    );

    expect(html).toContain('data-role="candidate-cap"');
    expect(html).toContain('940');
  });

  it('says nothing about a slice when the picker holds them all', () => {
    const html = renderToStaticMarkup(
      <Portfolios
        rows={[group()]}
        members={[]}
        candidates={[{ entityId: 'e1', displayName: 'شركة المثال' }]}
        candidateTotal={1}
        addMemberAction={noop}
        removeMemberAction={noop}
      />,
    );

    expect(html).not.toContain('data-role="candidate-cap"');
  });

  it('tells a stopped monitor apart from a running one', () => {
    const html = renderToStaticMarkup(
      <Portfolios
        rows={[group()]}
        members={[
          member({ monitorStatus: 'budget_exhausted' }),
          member({
            entityId: 'e2',
            displayName: 'مؤسسة ثانية',
            monitorStatus: null,
          }),
        ]}
        addMemberAction={noop}
        removeMemberAction={noop}
        candidates={[{ entityId: 'e3', displayName: 'ثالثة' }]}
        candidateTotal={3}
      />,
    );

    expect(html).toContain('توقفت: نفد سقفها');
    expect(html).toContain('بلا مراقبة');
    expect(html).not.toContain('>تعمل<');
  });

  it('promises no check at the moment of joining, because joining runs none', () => {
    const html = renderToStaticMarkup(<Portfolios rows={[]} createAction={noop} />);

    expect(html).not.toContain('ما يُتحقق به العضو الجديد');
    expect(html).toContain('الانضمام نفسه لا يُجري تحققاً');
  });

  it('has a sentence for every outcome its actions can send back', () => {
    for (const outcome of [
      'member_added',
      'member_watched',
      'member_watch_stopped',
      'member_exists',
      'member_removed',
      'member_removed_stopped',
      'member_gone',
      'member_invalid',
      'member_missing',
      'member_denied',
    ]) {
      // A redirect carrying a word no map knows prints nothing at all, and the person is
      // left looking at a screen that did not answer.
      expect(portfolioNotice(outcome), outcome).not.toBeNull();
    }
  });
});
