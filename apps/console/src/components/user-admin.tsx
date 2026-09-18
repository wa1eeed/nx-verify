import { Fragment, type ReactElement } from 'react';
import type { UserRole } from '@nx-verify/core';
import { AddPerson, type IssuedPasswordState } from './issued-once';
import { ROLE_HINTS, ROLE_LABELS, ROLE_ORDER } from './roles';
import { UserPermissions, type PermissionView } from './user-permissions';

export { ROLE_LABELS };

/**
 * Who is in this workspace, and what each of them may do.
 *
 * Until now an account could only be created from a command line by us, which made the
 * first thing a new subscriber wants to do the one thing they could not do themselves.
 *
 * A subscriber is the administrator of their own workspace, and the accounts they hand out
 * are the jobs in their company: somebody in finance, somebody in compliance, and the people
 * who verify customers. So the role is a preset for one of those, and each person's exact
 * permissions open underneath their row for the cases a preset does not fit.
 *
 * Three things this screen refuses, each because of a way it goes wrong. There is no way
 * to disable your own account, because locking yourself out is never what anyone meant
 * and the recovery is a support ticket. There is no way to leave the workspace with nobody
 * who can administer it, because a workspace in that state cannot appoint anyone. And a new
 * account's password is shown once and is temporary by construction: the person changes it
 * on first sign in, so the person who created the account never knows the password it ends
 * up with.
 */

export interface UserRowView {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: 'active' | 'disabled';
  /** True for the person looking at the screen. */
  isSelf: boolean;
  /** Every permission, whether they hold it, and whether their role is why. */
  permissions: PermissionView[];
}

export interface UserAdminProps {
  users: UserRowView[];
  /** How many people can still administer. The last one cannot be removed. */
  activeAdmins: number;
  /**
   * Making an account returns its temporary password to this screen and to nothing else
   * (SEC-10): it is in no address, no cookie and no log.
   */
  createAction: (previous: IssuedPasswordState, formData: FormData) => Promise<IssuedPasswordState>;
  roleAction: string | ((formData: FormData) => void | Promise<void>);
  statusAction: string | ((formData: FormData) => void | Promise<void>);
  capabilityAction: (formData: FormData) => void | Promise<void>;
  resetCapabilitiesAction: (formData: FormData) => void | Promise<void>;
}

export function UserAdmin({
  users,
  activeAdmins,
  createAction,
  roleAction,
  statusAction,
  capabilityAction,
  resetCapabilitiesAction,
}: UserAdminProps): ReactElement {
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <AddPerson action={createAction} />

      <div className="table-scroll">
        <table data-role="user-list">
          <thead>
            <tr>
              <th>الشخص</th>
              <th>الدور</th>
              <th>الحالة</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              // The last person who can administer cannot be moved out of it or disabled, and
              // the screen says why rather than failing when the button is pressed.
              const administers = user.permissions.some(
                (item) => item.code === 'users.manage' && item.held,
              );
              const lastAdmin = administers && user.status === 'active' && activeAdmins <= 1;
              return (
                <Fragment key={user.userId}>
                  <tr data-status={user.status}>
                    <td>
                      <div className="stack" style={{ gap: 0 }}>
                        <strong>{user.displayName}</strong>
                        <span className="faint mono" dir="ltr">
                          {user.email}
                        </span>
                      </div>
                    </td>
                    <td>
                      <form action={roleAction} className="stack" style={{ gap: 'var(--s-2)' }}>
                        <input type="hidden" name="user_id" value={user.userId} />
                        <div className="row" style={{ gap: 'var(--s-2)' }}>
                          <select
                            name="role"
                            defaultValue={user.role}
                            aria-label={`دور ${user.displayName}`}
                            style={{ width: 'auto' }}
                            disabled={lastAdmin}
                          >
                            {ROLE_ORDER.map((role) => (
                              <option key={role} value={role}>
                                {ROLE_LABELS[role]}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="btn btn-secondary" disabled={lastAdmin}>
                            حفظ
                          </button>
                        </div>
                        {/*
                          What the role actually means, under the control that sets it. A list
                          of six words is a list of six guesses without it.
                        */}
                        <span className="faint" data-role="role-hint">
                          {ROLE_HINTS[user.role]}
                        </span>
                      </form>
                    </td>
                    <td>{user.status === 'active' ? 'نشط' : 'معطّل'}</td>
                    <td className="row" style={{ gap: 'var(--s-2)' }}>
                      {/*
                        Both facts are shown when both apply. Being the last administrator
                        is what disables the role control, and a disabled control with no
                        reason beside it reads as a fault in the screen.
                      */}
                      {lastAdmin ? (
                        <span className="faint" data-role="last-admin">
                          آخر مسؤول
                        </span>
                      ) : null}
                      {user.isSelf ? (
                        <span className="faint" data-role="self">
                          أنت
                        </span>
                      ) : lastAdmin ? null : (
                        <form action={statusAction}>
                          <input type="hidden" name="user_id" value={user.userId} />
                          <input
                            type="hidden"
                            name="status"
                            value={user.status === 'active' ? 'disabled' : 'active'}
                          />
                          <button
                            type="submit"
                            className="btn btn-secondary"
                            data-role={user.status === 'active' ? 'disable-user' : 'enable-user'}
                          >
                            {user.status === 'active' ? 'تعطيل' : 'إعادة تفعيل'}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                  <tr data-role="permissions-row">
                    <td colSpan={4}>
                      <UserPermissions
                        userId={user.userId}
                        displayName={user.displayName}
                        roleLabel={ROLE_LABELS[user.role]}
                        permissions={user.permissions}
                        action={capabilityAction}
                        resetAction={resetCapabilitiesAction}
                        disabled={user.status === 'disabled'}
                      />
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
