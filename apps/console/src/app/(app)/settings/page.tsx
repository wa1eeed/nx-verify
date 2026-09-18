import type { ReactElement } from 'react';
import {
  countActiveAdmins,
  listCapabilityOverrides,
  listUsers,
  presetFor,
  resolveCapabilities,
} from '@nx-verify/core';
import { PageHeader } from '../../../components/page-header';
import { UserAdmin, type UserRowView } from '../../../components/user-admin';
import { permissionsOf } from '../../../components/user-permissions';
import { ROLE_LABELS } from '../../../components/roles';
import { actingUser, query } from '../../../lib/context';
import {
  createUserAction,
  resetCapabilitiesAction,
  setCapabilityAction,
  setRoleAction,
  setStatusAction,
} from './actions';
import { SectionTabs } from '../../../components/section-tabs';
import { SETTINGS_TABS, visible } from '../../../components/nav';

export const dynamic = 'force-dynamic';

/**
 * Who is in this workspace, and what each of them may do.
 *
 * Someone who may not administer sees the list and no controls. They are colleagues, and
 * knowing who else is here is not privileged: what they cannot do is change it.
 *
 * Each person's effective permissions are worked out here from their role and the exceptions
 * recorded against them, in two queries for the whole workspace rather than one per person.
 * The same arithmetic is in the database as `app.user_capabilities`, and a test holds the two
 * equal: this is the shortcut, not the source.
 */
export default async function UsersPage(): Promise<ReactElement> {
  const actor = await actingUser();

  const { users, activeAdmins, overrides } = await query(async (tx) => ({
    users: await listUsers(tx),
    activeAdmins: await countActiveAdmins(tx),
    overrides: await listCapabilityOverrides(tx),
  }));

  const rows: UserRowView[] = users.map((user) => {
    const held = resolveCapabilities(user.role, overrides.get(user.userId) ?? {}, user.status);
    return {
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      isSelf: user.userId === actor.userId,
      permissions: permissionsOf(held, presetFor(user.role)),
    };
  });

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="المستخدمون والصلاحيات"
        subtitle="من يدخل مساحة عملك، والدور الذي يعمل به، وما يملكه بالضبط."
      />
      <SectionTabs
        tabs={visible(SETTINGS_TABS, actor.capabilities)}
        current="/settings"
        label="أقسام الإعدادات"
      />
      {actor.can('users.manage') ? (
        <UserAdmin
          users={rows}
          activeAdmins={activeAdmins}
          createAction={createUserAction}
          roleAction={setRoleAction}
          statusAction={setStatusAction}
          capabilityAction={setCapabilityAction}
          resetCapabilitiesAction={resetCapabilitiesAction}
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
              <td>{ROLE_LABELS[user.role]}</td>
              <td>{user.status === 'active' ? 'نشط' : 'معطّل'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
