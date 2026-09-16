import type { ReactElement } from 'react';
import { canAdminister, countActiveAdmins, listUsers } from '@nx-verify/core';
import { PageHeader } from '../../../components/page-header';
import { UserAdmin, type UserRowView } from '../../../components/user-admin';
import { actingUser, query } from '../../../lib/context';
import { createUserAction, setRoleAction, setStatusAction } from './actions';
import { SectionTabs } from '../../../components/section-tabs';
import { SETTINGS_TABS } from '../../../components/nav';

export const dynamic = 'force-dynamic';

/**
 * Who is in this workspace.
 *
 * Someone who may not administer sees the list and no controls. They are colleagues, and
 * knowing who else is here is not privileged: what they cannot do is change it.
 */
export default async function UsersPage(): Promise<ReactElement> {
  const actor = await actingUser();

  const { users, activeAdmins } = await query(async (tx) => ({
    users: await listUsers(tx),
    activeAdmins: await countActiveAdmins(tx),
  }));

  const rows: UserRowView[] = users.map((user) => ({
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    isSelf: user.userId === actor.userId,
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader title="المستخدمون" subtitle="من يدخل مساحة عملك، وصلاحيات كل منهم." />
      {canAdminister(actor.role) ? (
        <UserAdmin
          users={rows}
          activeAdmins={activeAdmins}
          createAction={createUserAction}
          roleAction={setRoleAction}
          statusAction={setStatusAction}
        />
      ) : (
        <ReadOnlyList users={rows} />
      )}
    </div>
  );
}

/** The same people, with nothing to press. */
function ReadOnlyList({ users }: { users: UserRowView[] }): ReactElement {
  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={SETTINGS_TABS} current="/settings" label="أقسام الإعدادات" />
      <div className="table-scroll">
        <table data-role="user-list-readonly">
          <thead>
            <tr>
              <th>الشخص</th>
              <th>الدور</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.userId}>
                <td>{user.displayName}</td>
                <td>{user.role}</td>
                <td>{user.status === 'active' ? 'نشط' : 'معطّل'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
