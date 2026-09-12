import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { withTenant } from '../../../packages/db/src/client';
import { verify } from '../../../packages/core/src/verification/verify';
import { setTenantTtl } from '../../../packages/core/src/repositories/freshness';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing';
import { SAVED_VIEWS } from '../lib/views';
import type { ReactElement } from 'react';

/**
 * Unit 8 acceptance: a screen that works on real data.
 *
 * These render the actual page components against a real database, through the real
 * domain layer, after a real verification. Nothing here is a fixture except the provider,
 * which is the point of unit 3.
 */

const PROVIDER_NAME = 'wathq-example-connector';

describe('the console renders real data', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let entityId: string;
  const keys = testKeys();
  const fixture = providerFixture(PROVIDER_NAME);

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'شركة المثال للتجارة');
    await preparePricedTenant(db, tenant.tenantId, { providerName: PROVIDER_NAME });

    const result = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'KYB_COMPLETE',
        subject: { unn: '7001272184', manager: { id: '1098765432', id_type: 'NATIONAL_ID' } },
        subjectIdentifiers: [
          { idType: 'UNN', value: '7001272184', isPrimary: true },
          { idType: 'CR', value: '1010478213' },
        ],
        subjectDisplayName: 'شركة المثال للتجارة',
        triggeredBy: 'CONSOLE',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

    entityId = result.entityId ?? '';
    expect(result.status).toBe('OK');

    // The console reads its connection and its tenant from the environment until sessions
    // exist, and the page modules read them at import time.
    process.env['NX_APP_DATABASE_URL'] = db.appConnectionString;
    process.env['NX_CONSOLE_TENANT_ID'] = tenant.tenantId;
    process.env['NX_MASTER_KEY'] = Buffer.alloc(32, 7).toString('base64');
  });

  afterAll(async () => {
    const { closePool } = await import('../lib/context');
    const { closeSessionPool } = await import('../lib/session');
    const { closeOperatorPool } = await import('../lib/operator');
    await closePool();
    await closeSessionPool();
    await closeOperatorPool();
    await db.close();
  });

  const render = async (element: Promise<ReactElement>): Promise<string> =>
    renderToStaticMarkup(await element);

  it('shows entity 360 with fields, provenance and a timeline', async () => {
    const { default: EntityPage } = await import('../app/(app)/entities/[id]/page.js');
    const html = await render(EntityPage({ params: Promise.resolve({ id: entityId }) }));

    expect(html).toContain('شركة المثال للتجارة');
    expect(html).toContain('data-field="cr.status"');
    expect(html).toContain('Commercial Registry');
    expect(html).toContain('data-role="timeline"');
    // Triggered from the console, and the timeline says so.
    expect(html).toContain('يدوي من الكونسول');
  });

  it('masks every identifier it shows', async () => {
    const { default: EntityPage } = await import('../app/(app)/entities/[id]/page.js');
    const html = await render(EntityPage({ params: Promise.resolve({ id: entityId }) }));

    // Rule 4. The full value never reaches a screen.
    expect(html).not.toContain('7001272184');
    expect(html).not.toContain('1010478213');
    expect(html).toContain('••••');
    expect(html).toContain('dir="ltr"');
  });

  it('never names the provider on any screen', async () => {
    const { default: EntityPage } = await import('../app/(app)/entities/[id]/page.js');
    const { default: RegistryPage } = await import('../app/(app)/registry/page.js');

    const entity = await render(EntityPage({ params: Promise.resolve({ id: entityId }) }));
    const registry = await render(RegistryPage({ searchParams: Promise.resolve({}) }));

    for (const html of [entity, registry]) {
      expect(html).not.toContain(PROVIDER_NAME);
    }
    // The authority does appear, which is the distinction rule 5 exists to make.
    expect(entity).toContain('Commercial Registry');
  });

  it('lists the entity in the registry and links to it', async () => {
    const { default: RegistryPage } = await import('../app/(app)/registry/page.js');
    const html = await render(
      RegistryPage({ searchParams: Promise.resolve({ view: 'businesses' }) }),
    );

    expect(html).toContain(`/entities/${entityId}`);
    expect(html).toContain('شركة المثال للتجارة');
  });

  it('shows the people created by normalisation under their own saved view', async () => {
    const { default: RegistryPage } = await import('../app/(app)/registry/page.js');
    const html = await render(RegistryPage({ searchParams: Promise.resolve({ view: 'people' }) }));

    // The manager became an entity of its own during normalisation, and appears here
    // without a screen having been written for managers.
    expect(html).toContain('/entities/');
    expect(html).toContain('الأشخاص');
  });

  it('covers every entity type the database allows with a saved view', async () => {
    const { rows } = await db.migratorPool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint WHERE conname = 'ck_entities_type'`,
    );

    const definition = rows[0]?.definition ?? '';
    for (const view of SAVED_VIEWS) {
      expect(definition, `${view.entityType} must be a valid entity type`).toContain(
        view.entityType,
      );
    }
    // ADR-002: a new kind of entity is a saved view, never a new screen.
    for (const entityType of ['BUSINESS', 'PERSON', 'FREELANCER', 'BANK_ACCOUNT', 'PROPERTY']) {
      expect(
        SAVED_VIEWS.some((view) => view.entityType === entityType),
        `${entityType} has no saved view`,
      ).toBe(true);
    }
  });

  it('shows the retention settings with their source', async () => {
    const { default: SettingsPage } = await import('../app/(app)/settings/freshness/page.js');
    const html = await render(SettingsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('data-source="system"');
    expect(html).toContain('حالة السجل التجاري');
    expect(html).toContain('data-role="inert-notice"');
  });

  it('previews the impact of a retention change on this tenant own data', async () => {
    const { default: SettingsPage } = await import('../app/(app)/settings/freshness/page.js');
    const html = await render(
      SettingsPage({
        searchParams: Promise.resolve({ field: 'cr.core.name', ttl: '1' }),
      }),
    );

    expect(html).toContain('data-role="impact-preview"');
    expect(html).toContain('كياناً إلى حالة منتهي الصلاحية');
  });

  it('marks a tenant override in the settings table', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      setTenantTtl(tx, { fieldPath: 'cr.status', ttlDays: 3, weight: 20 }),
    );

    const { default: SettingsPage } = await import('../app/(app)/settings/freshness/page.js');
    const html = await render(SettingsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('data-source="tenant"');
    expect(html).toContain('معدّل من المشترك');
  });

  it('renders the risk dashboard, the queue and the portfolios on real data', async () => {
    const { default: DashboardPage } = await import('../app/(app)/dashboard/page');
    const { default: QueuePage } = await import('../app/(app)/queue/page');
    const { default: PortfoliosPage } = await import('../app/(app)/portfolios/page');

    const dashboard = renderToStaticMarkup(await DashboardPage());
    const queue = renderToStaticMarkup(await QueuePage());
    const portfolios = renderToStaticMarkup(await PortfoliosPage());

    expect(dashboard).toContain('لوحة المخاطر');
    expect(dashboard).toContain('data-role="tiles"');
    expect(queue).toContain('طابور المراجعة');
    expect(portfolios).toContain('المحافظ');

    // Rule 5 holds on every screen, not only the ones written first.
    for (const html of [dashboard, queue, portfolios]) {
      expect(html).not.toContain(PROVIDER_NAME);
    }
  });

  it('renders the rules studio with a simulation on this tenant own entities', async () => {
    const { default: RulesPage } = await import('../app/(app)/settings/rules/page');
    const html = renderToStaticMarkup(
      await RulesPage({ searchParams: Promise.resolve({ simulate: '1' }) }),
    );

    expect(html).toContain('قواعد القرار');
    expect(html).toContain('data-role="simulation"');
    // The default set is published by the operator and cannot be edited by a tenant.
    expect(html).toContain('غير قابل للتعديل');
  });

  it('refuses the operator panel without a token, and shows it with one', async () => {
    const { default: OperatorPage } = await import('../app/(app)/operator/providers/page');

    delete process.env['NX_OPERATOR_TOKEN_OVERRIDE'];
    process.env['NX_OPERATOR_TOKEN'] = 'operator-token-long-enough-1234';
    process.env['NX_OPERATOR_DATABASE_URL'] = db.operatorConnectionString;

    // No token, no page. Every provider name on this screen depends on that refusal.
    await expect(OperatorPage()).rejects.toThrow();

    process.env['NX_OPERATOR_TOKEN_OVERRIDE'] = 'operator-token-long-enough-1234';
    const html = renderToStaticMarkup(await OperatorPage());

    expect(html).toContain('data-role="bindings"');
    expect(html).toContain(PROVIDER_NAME);
    expect(html).toContain('المشترك لا يرى اسم أي مزوّد');

    delete process.env['NX_OPERATOR_TOKEN_OVERRIDE'];
  });

  it('names no provider on a subscriber screen even while the operator panel does', async () => {
    const { default: RegistryPage } = await import('../app/(app)/registry/page');
    const { default: DashboardPage } = await import('../app/(app)/dashboard/page');

    // The operator panel and these pages read the same database. Only one of them may
    // say the name, and it is the one a subscriber cannot open.
    for (const html of [
      renderToStaticMarkup(await RegistryPage({ searchParams: Promise.resolve({}) })),
      renderToStaticMarkup(await DashboardPage()),
    ]) {
      expect(html).not.toContain(PROVIDER_NAME);
    }
  });

  it('reports completeness gaps the tenant can act on', async () => {
    const { default: RegistryPage } = await import('../app/(app)/registry/page.js');
    const html = await render(RegistryPage({ searchParams: Promise.resolve({ view: 'people' }) }));

    // People carry none of the business fields, so the gap section has something to say.
    expect(html).toContain('data-role="completeness"');
    expect(html).toContain('كياناً بلا');
  });
});
