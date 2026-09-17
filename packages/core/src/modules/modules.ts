import type { Queryable, TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';

/**
 * Modules: what a subscriber buys, and what a customer file draws (ADR-137).
 *
 * A module is a named group of verification products that fills one section of a customer
 * file. It exists because neither of the two things it replaced was the unit anybody decides
 * about. A product code is too small: income verification is one product today and will be
 * three, and sold by code the owner has to remember which codes travel together. A plan is too
 * large: the customer who wants everything except property does not want a fourth plan
 * invented for them.
 *
 * Operator surface. Every function takes the operator connection and crosses subscribers by
 * design, which is allowed for configuration and nothing else: these tables say what a
 * subscriber bought, never whom they verified (guard 02).
 */

export interface ModuleProductView {
  productCode: string;
  nameAr: string;
  availability: 'AVAILABLE' | 'COMING_SOON';
  /** Filled by this product in a customer file. False for a product sold only through the API. */
  inFile: boolean;
}

export interface ModuleView {
  code: string;
  nameAr: string;
  nameEn: string;
  summaryAr: string;
  /** The section of a customer file it draws. Null for a module sold only through the API. */
  section: string | null;
  position: number;
  core: boolean;
  defaultOn: boolean;
  status: 'active' | 'retired';
  products: ModuleProductView[];
  /** Subscribers switched on and off by hand. The rest follow their plan. */
  switchedOn: number;
  switchedOff: number;
}

const MODULE_SELECT = `
  SELECT m.code, m.name_ar, m.name_en, m.summary_ar, m.section, m.position, m.core,
         m.default_on, m.status,
         (SELECT count(*) FROM tenant_modules tm
           WHERE tm.module_code = m.code AND tm.enabled) AS switched_on,
         (SELECT count(*) FROM tenant_modules tm
           WHERE tm.module_code = m.code AND NOT tm.enabled) AS switched_off
    FROM modules m
   ORDER BY m.position, m.code`;

interface ModuleRow {
  code: string;
  name_ar: string;
  name_en: string;
  summary_ar: string;
  section: string | null;
  position: number;
  core: boolean;
  default_on: boolean;
  status: 'active' | 'retired';
  switched_on: string;
  switched_off: string;
}

interface ProductRow {
  code: string;
  name_ar: string;
  availability: 'AVAILABLE' | 'COMING_SOON';
  module_code: string;
  profile_section: string | null;
}

/** Every module, with the products it sells and how many subscribers were decided for by hand. */
export async function listModules(operator: Queryable): Promise<ModuleView[]> {
  const [{ rows: modules }, { rows: products }] = [
    await operator.query<ModuleRow>(MODULE_SELECT),
    await operator.query<ProductRow>(
      `SELECT code, name_ar, availability, module_code, profile_section
         FROM products
        WHERE status = 'active'
        ORDER BY check_order, code`,
    ),
  ];

  return modules.map((row) => ({
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    summaryAr: row.summary_ar,
    section: row.section,
    position: row.position,
    core: row.core,
    defaultOn: row.default_on,
    status: row.status,
    products: products
      .filter((product) => product.module_code === row.code)
      .map((product) => ({
        productCode: product.code,
        nameAr: product.name_ar,
        availability: product.availability,
        inFile: product.profile_section !== null,
      })),
    switchedOn: Number(row.switched_on),
    switchedOff: Number(row.switched_off),
  }));
}

/** Where a module's answer for one subscriber came from. */
export type ModuleSource = 'core' | 'switch' | 'plan' | 'default';

export interface TenantModuleView {
  code: string;
  nameAr: string;
  summaryAr: string;
  section: string | null;
  position: number;
  core: boolean;
  /** What is true for this subscriber right now. */
  enabled: boolean;
  /** Why it is true: their own switch, their plan, the module's default, or it cannot be off. */
  source: ModuleSource;
  /** What staff decided for them, if anybody has. Null means nobody has, and it is inherited. */
  decided: boolean | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  note: string | null;
  /** How many of the module's products their plan carries, and how many it has in all. */
  productsInPlan: number;
  products: number;
}

/**
 * What one subscriber has, module by module, and why.
 *
 * The «why» is the part a settings screen usually gets wrong. Copying the defaults onto every
 * subscriber at onboarding makes the screen simple and the truth unrecoverable: a year later
 * nobody can tell a deliberate choice from a default that has since changed. So nothing is
 * copied. A subscriber inherits until somebody decides, and the screen says which is which.
 */
export async function tenantModules(
  operator: Queryable,
  tenantId: string,
): Promise<TenantModuleView[]> {
  const { rows } = await operator.query<{
    code: string;
    name_ar: string;
    summary_ar: string;
    section: string | null;
    position: number;
    core: boolean;
    default_on: boolean;
    decided: boolean | null;
    decided_by: string | null;
    decided_at: Date | null;
    note: string | null;
    products: string;
    products_in_plan: string;
  }>(
    `SELECT m.code, m.name_ar, m.summary_ar, m.section, m.position, m.core, m.default_on,
            tm.enabled AS decided, tm.decided_by, tm.decided_at, tm.note,
            (SELECT count(*) FROM products p
              WHERE p.module_code = m.code AND p.status = 'active') AS products,
            (SELECT count(*) FROM products p
               JOIN package_products pp ON pp.product_code = p.code AND pp.enabled
               JOIN tenant_commitments c
                 ON c.package_code = pp.package_code AND c.tenant_id = $1
              WHERE p.module_code = m.code AND p.status = 'active') AS products_in_plan
       FROM modules m
       LEFT JOIN tenant_modules tm ON tm.module_code = m.code AND tm.tenant_id = $1
      WHERE m.status = 'active'
      ORDER BY m.position, m.code`,
    [tenantId],
  );

  return rows.map((row) => {
    const inPlan = Number(row.products_in_plan);
    const source: ModuleSource = row.core
      ? 'core'
      : row.decided !== null
        ? 'switch'
        : inPlan > 0
          ? 'plan'
          : 'default';
    return {
      code: row.code,
      nameAr: row.name_ar,
      summaryAr: row.summary_ar,
      section: row.section,
      position: row.position,
      core: row.core,
      enabled: row.core ? true : (row.decided ?? (inPlan > 0 || row.default_on)),
      source,
      decided: row.decided,
      decidedBy: row.decided_by,
      decidedAt: row.decided_at,
      note: row.note,
      products: Number(row.products),
      productsInPlan: inPlan,
    };
  });
}

export interface SetTenantModuleInput {
  tenantId: string;
  moduleCode: string;
  /** Null lifts the decision and lets their plan and the module's default answer again. */
  enabled: boolean | null;
  note?: string | null;
}

/**
 * Gives one subscriber a module, or takes it away.
 *
 * Taking it away removes its whole section from every one of their customer files, and
 * refuses its products on the API with it, so a screen and an endpoint can never disagree
 * about what somebody bought.
 */
export async function setTenantModule(
  operator: Queryable,
  input: SetTenantModuleInput,
  operatorId: string,
): Promise<void> {
  const { rows } = await operator.query<{ core: boolean; name_ar: string }>(
    `SELECT core, name_ar FROM modules WHERE code = $1 AND status = 'active'`,
    [input.moduleCode],
  );
  const module = rows[0];
  if (!module) {
    throw new NxError('NX-4041', {
      detail: `No such module: ${input.moduleCode}`,
      cause: 'لا يوجد موديول بهذا الرمز.',
    });
  }
  // A core module is not a choice. Refusing here rather than silently ignoring it means the
  // screen and the API say the same thing, and nobody thinks they turned the registry off.
  if (module.core && input.enabled === false) {
    throw new NxError('NX-4003', {
      detail: `Module ${input.moduleCode} is core and cannot be switched off`,
      cause: `«${module.name_ar}» أساس كل ملف عميل ولا يمكن تعطيله.`,
    });
  }

  if (input.enabled === null) {
    await operator.query(`DELETE FROM tenant_modules WHERE tenant_id = $1 AND module_code = $2`, [
      input.tenantId,
      input.moduleCode,
    ]);
  } else {
    await operator.query(
      `INSERT INTO tenant_modules (tenant_id, module_code, enabled, decided_by, note)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, module_code) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         decided_by = EXCLUDED.decided_by,
         decided_at = now(),
         note = EXCLUDED.note`,
      [input.tenantId, input.moduleCode, input.enabled, operatorId, input.note ?? null],
    );
  }

  await operator.query(
    `INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, target, metadata)
     VALUES ($1, 'NX_STAFF', $2, 'module.set', $3, $4::jsonb)`,
    [
      input.tenantId,
      operatorId,
      `module:${input.moduleCode}`,
      JSON.stringify({ enabled: input.enabled, note: input.note ?? null }),
    ],
  );
}

export interface OwnModuleView {
  code: string;
  nameAr: string;
  summaryAr: string;
  core: boolean;
  /** On for this workspace right now, whatever decided it. */
  enabled: boolean;
  /** What the products under it are called, for a screen that is choosing between them. */
  products: { code: string; nameAr: string }[];
}

/**
 * The modules as the subscriber themselves sees them (ADR-154).
 *
 * Read in the workspace's own scope, so it says what *this* workspace has and cannot be asked
 * about another. The resolution is the same cascade the entitlement check uses: an explicit
 * row wins, then the plan, then the module's own default, and core is always on.
 */
export async function ownModules(tx: TenantTransaction): Promise<OwnModuleView[]> {
  const { rows } = await tx.query<{
    code: string;
    name_ar: string;
    summary_ar: string;
    core: boolean;
    enabled: boolean;
    products: { code: string; nameAr: string }[] | null;
  }>(
    `SELECT m.code, m.name_ar, m.summary_ar, m.core,
            COALESCE(tm.enabled, m.default_on) OR m.core AS enabled,
            (SELECT json_agg(json_build_object('code', p.code, 'nameAr', p.name_ar)
                               ORDER BY p.code)
               FROM products p
              WHERE p.module_code = m.code AND p.status = 'active') AS products
       FROM modules m
       LEFT JOIN tenant_modules tm
         ON tm.module_code = m.code AND tm.tenant_id = $1
      WHERE m.status = 'active'
      ORDER BY m.core DESC, m.position, m.code`,
    [tx.tenantId],
  );

  return rows.map((row) => ({
    code: row.code,
    nameAr: row.name_ar,
    summaryAr: row.summary_ar,
    core: row.core,
    enabled: row.enabled,
    products: row.products ?? [],
  }));
}

/**
 * A subscriber switching an add-on on or off for themselves.
 *
 * Safe to let them do, because switching a module on costs nothing: it decides which sections
 * their customer files draw and which products their calls may use, and every one of those
 * still spends from a wallet that an operator has to fund. Turning everything on and having no
 * balance buys exactly nothing.
 *
 * Core refuses, with the same code and the same sentence the panel gives, so a subscriber and
 * a member of staff are told the same thing about the same rule.
 */
export async function setOwnModule(
  tx: TenantTransaction,
  input: { moduleCode: string; enabled: boolean; userId: string },
): Promise<void> {
  const { rows } = await tx.query<{ core: boolean; name_ar: string }>(
    `SELECT core, name_ar FROM modules WHERE code = $1 AND status = 'active'`,
    [input.moduleCode],
  );
  const module = rows[0];
  if (!module) {
    throw new NxError('NX-4041', {
      detail: `No such module: ${input.moduleCode}`,
      cause: 'لا يوجد موديول بهذا الرمز.',
    });
  }
  if (module.core && !input.enabled) {
    throw new NxError('NX-4003', {
      detail: `Module ${input.moduleCode} is core and cannot be switched off`,
      cause: `«${module.name_ar}» أساس كل ملف عميل ولا يمكن تعطيله.`,
    });
  }

  await tx.query(
    `INSERT INTO tenant_modules (tenant_id, module_code, enabled, decided_by, note)
     VALUES ($1, $2, $3, $4, 'اختيار المشترك')
     ON CONFLICT (tenant_id, module_code) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       decided_by = EXCLUDED.decided_by,
       decided_at = now(),
       note = EXCLUDED.note`,
    [tx.tenantId, input.moduleCode, input.enabled, input.userId],
  );
}
