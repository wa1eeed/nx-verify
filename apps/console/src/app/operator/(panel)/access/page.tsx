import type { ReactElement } from 'react';
import {
  listOperatorAccounts,
  listOperatorAudit,
  listPlans,
  listSubscribers,
  operatorCan,
} from '@nx-verify/core';
import { AdminAccess } from '../../../../components/admin-access';
import { AUDIT_SCOPES, auditScopeOf } from '../../../../components/admin-access/model';
import {
  OPERATOR_SESSION_HOURS,
  TOKEN_OPERATOR,
  currentOperator,
  operatorQuery,
} from '../../../../lib/operator';
import { operatorNameOf } from '../../../../lib/operator-names';
import { addStaffAction, changeOwnPasswordAction, updateStaffAction } from './actions';

/** Never prerendered, and refuses to render without a sign in. */
export const dynamic = 'force-dynamic';

const NOTICES: Readonly<Record<string, { tone: 'done' | 'refused'; text: string }>> = {
  'staff-added': { tone: 'done', text: 'أُضيف العضو. يدخل ببريده وكلمة المرور التي عيّنتها.' },
  'staff-updated': { tone: 'done', text: 'حُفظت التغييرات.' },
  password: { tone: 'done', text: 'تغيّرت كلمة المرور.' },
  'refused:password': { tone: 'refused', text: 'لم يُحفظ: كلمة المرور 12 حرفاً على الأقل.' },
  'refused:exists': { tone: 'refused', text: 'لم يُحفظ: في الفريق عضو بهذا البريد.' },
  'refused:last-owner': {
    tone: 'refused',
    text: 'لم يُحفظ: تبقى في اللوحة دائماً مالك واحد مفعّل على الأقل.',
  },
  'refused:current': { tone: 'refused', text: 'لم تتغيّر: كلمة المرور الحالية غير صحيحة.' },
  'refused:invalid': {
    tone: 'refused',
    text: 'لم يُحفظ: تحقق من الاسم والبريد والدور.',
  },
};

/**
 * Who may enter the panel and what staff changed (handoff screen 00, «الصلاحيات والتدقيق»).
 *
 * The trail reads operator_audit, which holds references, field names and figures and never
 * material (ADR-109), and names each change's author from their account (ADR-117).
 */
export default async function OperatorAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const operator = await currentOperator();
  const params = await searchParams;
  const scope = auditScopeOf(typeof params['scope'] === 'string' ? params['scope'] : undefined);
  const actions = AUDIT_SCOPES.find((entry) => entry.key === scope)?.actions ?? [];

  const data = await operatorQuery(async (db) => ({
    accounts: await listOperatorAccounts(db),
    audit: await listOperatorAudit(db, { actionPrefixes: actions, limit: 200 }),
    plans: await listPlans(db),
    subscribers: await listSubscribers(db),
    products: (
      await db.query<{ code: string; name_ar: string }>(`SELECT code, name_ar FROM products`)
    ).rows,
  }));

  const refused = typeof params['refused'] === 'string' ? `refused:${params['refused']}` : null;
  const saved = typeof params['saved'] === 'string' ? params['saved'] : null;
  const notice =
    (refused === null ? undefined : (NOTICES[refused] ?? NOTICES['refused:invalid'])) ??
    (saved === null ? null : (NOTICES[saved] ?? null));

  return (
    <AdminAccess
      view={{
        accounts: data.accounts,
        selfId: operator.id === TOKEN_OPERATOR.id ? null : operator.id,
        canManageStaff: operatorCan(operator.role, 'staff'),
        sessionHours: OPERATOR_SESSION_HOURS,
        audit: data.audit.map((row) => ({ ...row, byName: operatorNameOf(row) })),
        scope,
        names: {
          products: new Map(data.products.map((row) => [row.code, row.name_ar])),
          plans: new Map(data.plans.map((plan) => [plan.code, plan.nameAr])),
          tenants: new Map(data.subscribers.map((row) => [row.tenantId, row.legalName])),
          staff: new Map(data.accounts.map((account) => [account.id, account.displayName])),
        },
        notice,
        now: new Date(),
      }}
      actions={{
        addStaff: addStaffAction,
        updateStaff: updateStaffAction,
        changeOwnPassword: changeOwnPasswordAction,
      }}
    />
  );
}
