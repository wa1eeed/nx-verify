import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { audit } from './audit.js';
import type { UserRole } from './users.js';

/**
 * What one of the customer's own people may do.
 *
 * A subscriber is the administrator of their own workspace, and the accounts they hand out
 * are the jobs in their company: somebody in finance, somebody in compliance, and the people
 * who verify customers. Roles alone could not say that. Four tiers of seniority answer «how
 * much is this person trusted», and the actual question is «what is this person here to do»,
 * which is a different shape: the accountant is trusted completely and still has no business
 * reading the national id of every company you ever checked.
 *
 * So a role is a preset for one of those jobs, and the unit that grants anything is the
 * capability. An administrator may hand one extra capability to one person, or take one
 * away, and the exception is stored rather than forcing them to invent a new role.
 *
 * The list here is held equal to the rows in migration 0060 by a test, because the four eyes
 * guard is a database trigger and it asks the same question through `app.user_can`. One
 * answer to «may they», read by both layers: a rule that lives only in application code is a
 * rule a hotfix removes.
 */

export type Capability =
  | 'customers.read'
  | 'verify.run'
  | 'review.decide'
  | 'review.approve'
  | 'monitoring.manage'
  | 'share.create'
  | 'wallet.read'
  | 'wallet.topup'
  | 'prices.manage'
  | 'rules.manage'
  | 'settings.manage'
  | 'users.manage'
  | 'developers.manage'
  | 'audit.read';

/** The place in the console a capability governs, so a screen groups rather than lists. */
export type CapabilityArea = 'customers' | 'verify' | 'billing' | 'settings';

export interface CapabilityInfo {
  code: Capability;
  nameAr: string;
  summaryAr: string;
  area: CapabilityArea;
  /** Holding this lets somebody spend from the wallet. Worth pausing over when granting. */
  spends: boolean;
}

/**
 * Named for what somebody loses when it is switched off, since that is the question an
 * administrator is actually answering when they look at the switch.
 */
export const CAPABILITIES: readonly CapabilityInfo[] = [
  {
    code: 'customers.read',
    nameAr: 'عرض العملاء',
    summaryAr: 'قائمة العملاء وملفاتهم وما رُصد عنهم',
    area: 'customers',
    spends: false,
  },
  {
    code: 'verify.run',
    nameAr: 'تشغيل التحقق',
    summaryAr: 'إرسال طلبات التحقق وملفات التأهيل',
    area: 'verify',
    spends: true,
  },
  {
    code: 'review.decide',
    nameAr: 'البتّ في حالات المراجعة',
    summaryAr: 'إصدار قرار قبول أو رفض على حالة مُحالة للمراجعة',
    area: 'customers',
    spends: false,
  },
  {
    code: 'review.approve',
    nameAr: 'اعتماد القرارات',
    summaryAr: 'اعتماد ما بتّ فيه غيره. لا يعتمد أحد قراره بنفسه',
    area: 'customers',
    spends: false,
  },
  {
    code: 'monitoring.manage',
    nameAr: 'إدارة المراقبة',
    summaryAr: 'إضافة عملاء تحت المراقبة وتغيير وتيرتها',
    area: 'customers',
    spends: true,
  },
  {
    code: 'share.create',
    nameAr: 'مشاركة ملف عميل',
    summaryAr: 'إصدار رابط مؤقت بملف عميل لجهة خارجية',
    area: 'customers',
    spends: false,
  },
  {
    code: 'wallet.read',
    nameAr: 'عرض الرصيد والفواتير',
    summaryAr: 'الاطلاع على الرصيد والباقة وسجل الفواتير',
    area: 'billing',
    spends: false,
  },
  {
    code: 'wallet.topup',
    nameAr: 'طلب شحن الرصيد',
    summaryAr: 'إرسال طلب شراء رصيد أو باقة باسم المنشأة',
    area: 'billing',
    spends: false,
  },
  {
    code: 'prices.manage',
    nameAr: 'إدارة الأسعار والسقوف',
    summaryAr: 'تعديل أسعار المنتجات وسقوف الإنفاق',
    area: 'billing',
    spends: false,
  },
  {
    code: 'rules.manage',
    nameAr: 'إدارة قواعد القرار',
    summaryAr: 'تعديل قواعد القبول والرفض والإحالة للمراجعة',
    area: 'settings',
    spends: false,
  },
  {
    code: 'settings.manage',
    nameAr: 'إعدادات مساحة العمل',
    summaryAr: 'التنبيهات ومدد الصلاحية والمجموعات والدخول الموحّد والخدمات المفعّلة',
    area: 'settings',
    spends: false,
  },
  {
    code: 'users.manage',
    nameAr: 'إدارة المستخدمين والصلاحيات',
    summaryAr: 'إضافة الموظفين وتعطيلهم وتحديد ما يملكه كل منهم',
    area: 'settings',
    spends: false,
  },
  {
    code: 'developers.manage',
    nameAr: 'مفاتيح الربط والـ Webhooks',
    summaryAr: 'إصدار مفاتيح الـAPI وإلغاؤها وضبط الـ Webhooks',
    area: 'settings',
    spends: false,
  },
  {
    code: 'audit.read',
    nameAr: 'سجل التدقيق',
    summaryAr: 'الاطلاع على سجل ما فعله كل مستخدم ومتى',
    area: 'settings',
    spends: false,
  },
];

const ALL: readonly Capability[] = CAPABILITIES.map((entry) => entry.code);

/**
 * The presets, each one a job in a company rather than a tier of seniority.
 *
 * Finance has no sight of customers on purpose, and that is the whole argument for this
 * file: somebody who pays invoices has no business reading the commercial registration and
 * the national id of every company that was ever checked. A platform that hands it to them
 * by default has made a decision on the subscriber's behalf that is not ours to make.
 *
 * Compliance may decide and approve but not run: the person answerable for a decision is
 * usually not the person who spends the balance making it. When a subscriber wants both,
 * that is one switch on one person, which is the case these presets exist to make easy.
 */
export const ROLE_PRESETS: Readonly<Record<UserRole, readonly Capability[]>> = {
  VIEWER: ['customers.read', 'wallet.read'],
  ANALYST: [
    'customers.read',
    'wallet.read',
    'verify.run',
    'review.decide',
    'monitoring.manage',
    'share.create',
  ],
  APPROVER: [
    'customers.read',
    'wallet.read',
    'verify.run',
    'review.decide',
    'review.approve',
    'monitoring.manage',
    'share.create',
  ],
  FINANCE: ['wallet.read', 'wallet.topup', 'prices.manage', 'audit.read'],
  COMPLIANCE: [
    'customers.read',
    'wallet.read',
    'review.decide',
    'review.approve',
    'monitoring.manage',
    'rules.manage',
    'share.create',
    'audit.read',
  ],
  ADMIN: ALL,
};

export function isCapability(value: string): value is Capability {
  return (ALL as readonly string[]).includes(value);
}

export function capabilityInfo(code: Capability): CapabilityInfo {
  const found = CAPABILITIES.find((entry) => entry.code === code);
  if (!found) {
    throw new NxError('NX-5001', { detail: `unknown capability ${code}` });
  }
  return found;
}

/**
 * What a role carries before any exception, computed here so a screen can show the preset
 * beside the switches without a round trip.
 */
export function presetFor(role: UserRole): ReadonlySet<Capability> {
  return new Set(ROLE_PRESETS[role]);
}

/** One person's exceptions: true was added to their preset, false was taken away. */
export type CapabilityOverrides = Readonly<Partial<Record<Capability, boolean>>>;

export function resolveCapabilities(
  role: UserRole,
  overrides: CapabilityOverrides = {},
  status: 'active' | 'disabled' = 'active',
): ReadonlySet<Capability> {
  // A disabled account holds nothing. That makes disabling somebody a complete answer
  // rather than a flag every screen has to remember to check.
  if (status === 'disabled') {
    return new Set<Capability>();
  }
  const effective = new Set<Capability>(ROLE_PRESETS[role]);
  for (const [code, granted] of Object.entries(overrides)) {
    if (!isCapability(code)) {
      continue;
    }
    if (granted) {
      effective.add(code);
    } else {
      effective.delete(code);
    }
  }
  return effective;
}

export function assertCan(held: ReadonlySet<Capability>, needed: Capability): void {
  if (!held.has(needed)) {
    throw new NxError('NX-4031', {
      detail: `this user does not hold ${needed}`,
    });
  }
}

export interface UserCapabilityView {
  userId: string;
  role: UserRole;
  status: 'active' | 'disabled';
  /** Everything they may do right now. */
  effective: ReadonlySet<Capability>;
  /** Only what differs from the preset, which is what the screen highlights. */
  overrides: CapabilityOverrides;
}

/**
 * The exceptions recorded for everybody in the workspace, in one read.
 *
 * The screen that lists people needs a switch state per person per capability, and a query
 * per row would be fourteen times the people. The effective set is computed here from the
 * role and these rows rather than asked of `app.user_capabilities` once per person, and the
 * test that holds this file equal to the migration is what makes the two agree.
 */
export async function listCapabilityOverrides(
  tx: TenantTransaction,
): Promise<Map<string, CapabilityOverrides>> {
  const { rows } = await tx.query<{ user_id: string; capability: string; granted: boolean }>(
    `SELECT user_id, capability, granted FROM user_capabilities WHERE tenant_id = $1`,
    [tx.tenantId],
  );

  const byUser = new Map<string, Record<string, boolean>>();
  for (const row of rows) {
    const existing = byUser.get(row.user_id) ?? {};
    existing[row.capability] = row.granted;
    byUser.set(row.user_id, existing);
  }
  return byUser as Map<string, CapabilityOverrides>;
}

/** One person's exceptions, for a screen that shows one person. */
export async function capabilityOverridesFor(
  tx: TenantTransaction,
  userId: string,
): Promise<CapabilityOverrides> {
  const { rows } = await tx.query<{ capability: string; granted: boolean }>(
    `SELECT capability, granted FROM user_capabilities
      WHERE tenant_id = $1 AND user_id = $2`,
    [tx.tenantId, userId],
  );
  const overrides: Record<string, boolean> = {};
  for (const row of rows) {
    overrides[row.capability] = row.granted;
  }
  return overrides as CapabilityOverrides;
}

/**
 * What the signed in person may do, asked of the database rather than computed.
 *
 * The console calls this once per screen. It goes to `app.user_capabilities` so that the
 * answer a screen renders and the answer the four eyes trigger enforces come from the same
 * function: if they ever disagree, the person sees a button that the database refuses, which
 * is the worst of both.
 */
export async function capabilitiesOf(
  tx: TenantTransaction,
  userId: string,
): Promise<ReadonlySet<Capability>> {
  const { rows } = await tx.query<{ capability: string }>(
    `SELECT capability FROM app.user_capabilities($1, $2)`,
    [tx.tenantId, userId],
  );
  const held = new Set<Capability>();
  for (const row of rows) {
    if (isCapability(row.capability)) {
      held.add(row.capability);
    }
  }
  return held;
}

export interface SetCapabilityInput {
  userId: string;
  capability: Capability;
  /** true grants, false takes away, null returns the person to their preset. */
  granted: boolean | null;
  actorId: string;
}

/**
 * Change one switch for one person.
 *
 * Two refusals, both about the same failure: a workspace nobody can administer. An
 * administrator may not take `users.manage` from themselves, and may not take it from the
 * last person who holds it. Everything else about this screen is reversible by somebody; a
 * workspace with no administrator is reversible by nobody but us.
 */
export async function setUserCapability(
  tx: TenantTransaction,
  input: SetCapabilityInput,
): Promise<void> {
  const { rows: target } = await tx.query<{ role: UserRole; status: 'active' | 'disabled' }>(
    `SELECT role, status FROM users WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, input.userId],
  );
  const user = target[0];
  if (!user) {
    throw new NxError('NX-4041', { detail: 'no such user' });
  }

  // Taking your own administration away is never the thing somebody meant to do, and the
  // recovery is a support ticket to us rather than anything they can do themselves. Said
  // before the write, because this refusal has its own reason and its own words.
  const losingOwn =
    input.userId === input.actorId &&
    input.capability === 'users.manage' &&
    (input.granted === false ||
      (input.granted === null && !presetFor(user.role).has('users.manage')));
  if (losingOwn) {
    throw new NxError('NX-4003', {
      detail: 'an administrator cannot remove their own administration',
    });
  }

  await withAdminRemaining(tx, async () => {
    if (input.granted === null) {
      await tx.query(
        `DELETE FROM user_capabilities
          WHERE tenant_id = $1 AND user_id = $2 AND capability = $3`,
        [tx.tenantId, input.userId, input.capability],
      );
    } else {
      await tx.query(
        `INSERT INTO user_capabilities (tenant_id, user_id, capability, granted, set_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, user_id, capability)
         DO UPDATE SET granted = EXCLUDED.granted, set_by = EXCLUDED.set_by, set_at = now()`,
        [tx.tenantId, input.userId, input.capability, input.granted, input.actorId],
      );
    }
  });

  await audit(tx, {
    actorType: 'USER',
    actorId: input.actorId,
    action: 'user.capability.set',
    target: input.userId,
    metadata: { capability: input.capability, granted: input.granted },
  });
}

const ADMIN_SAVEPOINT = 'nx_admin_change';

/**
 * Makes a change, and keeps it only if somebody can still administer the workspace.
 *
 * Predicting the effect beforehand was wrong in the case that matters: somebody explicitly
 * granted `users.manage` keeps it when their role is lowered, and a pre-check that reads the
 * role would refuse a change that is perfectly safe. So the change is made and the database is
 * asked what is now true.
 *
 * The savepoint is what makes that honest. Relying on the surrounding transaction to roll
 * back works only until a caller catches the error and carries on, and then the refusal has
 * printed a message while leaving the workspace in exactly the state it refused to allow.
 * A test caught that, which is the argument for rule 11 in one line.
 */
export async function withAdminRemaining(
  tx: TenantTransaction,
  change: () => Promise<void>,
): Promise<void> {
  // What is refused is taking the last one away, not making a change in a workspace that
  // already has none. Those are different situations and only the first is this rule's
  // business: a workspace provisioned before this screen existed, or one whose administrator
  // was removed some other way, must still be repairable from here rather than frozen by a
  // guard protecting something that is already gone.
  const before = await countAdministrators(tx);

  await tx.query(`SAVEPOINT ${ADMIN_SAVEPOINT}`);
  try {
    await change();
    if (before > 0 && (await countAdministrators(tx)) === 0) {
      throw new NxError('NX-4091', {
        detail: 'this is the only administrator left, and a workspace without one cannot add one',
      });
    }
  } catch (error) {
    await tx.query(`ROLLBACK TO SAVEPOINT ${ADMIN_SAVEPOINT}`);
    throw error;
  }
  await tx.query(`RELEASE SAVEPOINT ${ADMIN_SAVEPOINT}`);
}

/**
 * How many active people can administer this workspace.
 *
 * Counting administrators by role stopped being the right question the moment a capability
 * could be handed out on its own: the answer is whoever effectively holds `users.manage`,
 * including somebody who was granted it as an exception and excluding an administrator it
 * was taken from.
 */
export async function countAdministrators(tx: TenantTransaction): Promise<number> {
  const { rows } = await tx.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM users u
      WHERE u.tenant_id = $1
        AND u.status = 'active'
        AND app.user_can(u.tenant_id, u.id, 'users.manage')`,
    [tx.tenantId],
  );
  return Number(rows[0]?.count ?? '0');
}

/**
 * Give somebody a whole job at once.
 *
 * Changing a role keeps the exceptions an administrator deliberately made, because they
 * usually made them for a reason that outlives a promotion. The screen shows them as
 * exceptions, so nothing is hidden by this choice.
 */
export async function clearCapabilityOverrides(
  tx: TenantTransaction,
  userId: string,
  actorId: string,
): Promise<void> {
  // Clearing the exceptions can take the last administration away as surely as revoking it
  // one switch at a time, so it passes the same gate.
  await withAdminRemaining(tx, async () => {
    await tx.query(`DELETE FROM user_capabilities WHERE tenant_id = $1 AND user_id = $2`, [
      tx.tenantId,
      userId,
    ]);
  });
  await audit(tx, {
    actorType: 'USER',
    actorId,
    action: 'user.capability.reset',
    target: userId,
  });
}
