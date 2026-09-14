import type { ReactElement } from 'react';
import {
  OPERATOR_ROLE_LABELS,
  OPERATOR_ROLES,
  type OperatorAccount,
  type OperatorAuditRow,
} from '@nx-verify/core';
import { PageHeader } from '../page-header';
import { Card } from '../ui/card';
import { Ltr } from '../ui/ltr';
import { Notice } from '../ui/notice';
import { Table, Th } from '../ui/table';
import { Tag, TagLink } from '../ui/tag';
import { dateAr, sinceAr, timeOfDay } from '../format';
import { AddStaffDialog, EditStaffDialog, OwnPasswordDialog } from './dialogs';
import {
  AUDIT_SCOPES,
  ROLE_DESCRIPTIONS,
  auditActionAr,
  auditChangeAr,
  auditTargetAr,
  type AuditNames,
  type AuditScope,
} from './model';

/**
 * Who may enter the administration panel and with what role, and everything staff changed
 * (handoff screen 00, «الصلاحيات والتدقيق»).
 *
 * Staff sign in as themselves (PLAN.md, decision 5), so the trail names a person for every
 * change. Only an owner adds staff or changes a role, and the panel always keeps one active
 * owner.
 */

type Action = (formData: FormData) => Promise<void>;

export interface AdminAccessView {
  accounts: readonly OperatorAccount[];
  /** The signed in account, or null for the deployment's token outside production. */
  selfId: string | null;
  canManageStaff: boolean;
  sessionHours: number;
  audit: readonly (OperatorAuditRow & { byName: string })[];
  scope: AuditScope;
  names: AuditNames;
  notice: { tone: 'done' | 'refused'; text: string } | null;
  now: Date;
}

export interface AdminAccessActions {
  addStaff: Action;
  updateStaff: Action;
  changeOwnPassword: Action;
}

export function AdminAccess({
  view,
  actions,
}: {
  view: AdminAccessView;
  actions: AdminAccessActions;
}): ReactElement {
  return (
    <div className="admin-screen" data-role="admin-access">
      <PageHeader
        title="الصلاحيات والتدقيق"
        subtitle="من يدخل لوحة الإدارة وبأي دور، وكل تغيير أجراه الفريق: ما الذي تغيّر، ومن غيّره، ومتى."
        action={view.canManageStaff ? <AddStaffDialog action={actions.addStaff} /> : undefined}
      />

      {view.notice === null ? null : (
        <Notice tone={view.notice.tone} role="access-notice">
          {view.notice.text}
        </Notice>
      )}

      <Card variant="flush" role="staff" labelledBy="staff-title">
        <div className="admin-card-head">
          <h2 className="card-title admin-card-title" id="staff-title">
            فريق الإدارة
          </h2>
          <div className="admin-head-actions">
            <p className="admin-card-note">
              كل عضو يدخل ببريده وكلمة مروره، والجلسة تنتهي بعد <Ltr>{view.sessionHours}</Ltr>{' '}
              ساعات.
            </p>
            {view.selfId === null ? null : <OwnPasswordDialog action={actions.changeOwnPassword} />}
          </div>
        </div>
        {view.accounts.length === 0 ? (
          <p className="admin-empty" data-role="empty-state">
            لا حساب في اللوحة بعد.
          </p>
        ) : (
          <div className="admin-table">
            <Table label="فريق الإدارة">
              <thead>
                <tr>
                  <Th>الاسم</Th>
                  <Th>البريد</Th>
                  <Th>الدور</Th>
                  <Th>الحالة</Th>
                  <Th>آخر دخول</Th>
                  {view.canManageStaff ? (
                    <Th>
                      <span className="visually-hidden">إجراء</span>
                    </Th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {view.accounts.map((account) => (
                  <tr key={account.id} data-role="staff-row">
                    <td>
                      {account.displayName}
                      {account.id === view.selfId ? (
                        <span className="admin-offer-terms"> · أنت</span>
                      ) : null}
                    </td>
                    <td>
                      <Ltr>{account.email}</Ltr>
                    </td>
                    <td>{OPERATOR_ROLE_LABELS[account.role]}</td>
                    <td>
                      {account.status === 'ACTIVE' ? (
                        <Tag tone="accent-2">مفعّل</Tag>
                      ) : (
                        <Tag tone="neutral">موقوف</Tag>
                      )}
                    </td>
                    <td>
                      {account.lastSignInAt === null
                        ? 'لم يدخل بعد'
                        : sinceAr(account.lastSignInAt, view.now)}
                    </td>
                    {view.canManageStaff ? (
                      <td>
                        <EditStaffDialog
                          action={actions.updateStaff}
                          account={{
                            id: account.id,
                            displayName: account.displayName,
                            role: account.role,
                            status: account.status,
                          }}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <ul className="admin-roles" data-role="roles">
          {OPERATOR_ROLES.map((role) => (
            <li key={role}>
              <strong>{OPERATOR_ROLE_LABELS[role]}</strong>: {ROLE_DESCRIPTIONS[role]}
            </li>
          ))}
        </ul>
      </Card>

      <Card variant="flush" role="audit" labelledBy="audit-title">
        <div className="admin-card-head">
          <h2 className="card-title admin-card-title" id="audit-title">
            سجل التغييرات
          </h2>
          <nav className="admin-tags" aria-label="تصفية السجل">
            {AUDIT_SCOPES.map((scope) => (
              <TagLink
                key={scope.key}
                href={
                  scope.key === 'all' ? '/operator/access' : `/operator/access?scope=${scope.key}`
                }
                tone={scope.key === view.scope ? 'accent' : 'neutral'}
                current={scope.key === view.scope}
              >
                {scope.label}
              </TagLink>
            ))}
          </nav>
        </div>
        {view.audit.length === 0 ? (
          <p className="admin-empty" data-role="empty-state">
            لم يُجرِ أحد أي تغيير هنا بعد.
          </p>
        ) : (
          <div className="admin-table">
            <Table label="سجل التغييرات">
              <thead>
                <tr>
                  <Th>الوقت</Th>
                  <Th>بواسطة</Th>
                  <Th>الإجراء</Th>
                  <Th>على</Th>
                  <Th>ما تغيّر</Th>
                </tr>
              </thead>
              <tbody>
                {view.audit.map((row, index) => (
                  <tr key={`${row.at.toISOString()}-${index}`} data-role="audit-row">
                    <td>
                      {dateAr(row.at)}، <Ltr>{timeOfDay(row.at)}</Ltr>
                    </td>
                    <td>{row.byName}</td>
                    <td>{auditActionAr(row.action)}</td>
                    <td>{auditTargetAr(row.target, view.names)}</td>
                    <td>{auditChangeAr(row)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
