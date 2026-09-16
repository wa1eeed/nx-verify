import type { ReactElement } from 'react';
import type { UserRole } from '@nx-verify/core';
import { AddPerson, type IssuedPasswordState } from './issued-once';
import { ROLE_LABELS } from './roles';

export { ROLE_LABELS };

/**
 * Who is in this workspace, and what each of them may do.
 *
 * Until now an account could only be created from a command line by us, which made the
 * first thing a new subscriber wants to do the one thing they could not do themselves.
 *
 * Three things this screen refuses, each because of a way it goes wrong. There is no way
 * to disable your own account, because locking yourself out is never what anyone meant
 * and the recovery is a support ticket. There is no way to remove the last administrator,
 * because a workspace without one cannot appoint one. And a new account's password is
 * shown once and is temporary by construction: the person changes it on first sign in, so
 * the person who created the account never knows the password it ends up with.
 */

export interface UserRowView {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: 'active' | 'disabled';
  /** True for the person looking at the screen. */
  isSelf: boolean;
}

export interface UserAdminProps {
  users: UserRowView[];
  /** How many administrators are still active. The last one cannot be removed. */
  activeAdmins: number;
  /**
   * Making an account returns its temporary password to this screen and to nothing else
   * (SEC-10): it is in no address, no cookie and no log.
   */
  createAction: (previous: IssuedPasswordState, formData: FormData) => Promise<IssuedPasswordState>;
  roleAction: string | ((formData: FormData) => void | Promise<void>);
  statusAction: string | ((formData: FormData) => void | Promise<void>);
}

export function UserAdmin({
  users,
  activeAdmins,
  createAction,
  roleAction,
  statusAction,
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
              // The last administrator cannot be demoted or disabled, and the screen says
              // why rather than failing when the button is pressed.
              const lastAdmin =
                user.role === 'ADMIN' && user.status === 'active' && activeAdmins <= 1;
              return (
                <tr key={user.userId} data-status={user.status}>
                  <td>
                    <div className="stack" style={{ gap: 0 }}>
                      <strong>{user.displayName}</strong>
                      <span className="faint mono" dir="ltr">
                        {user.email}
                      </span>
                    </div>
                  </td>
                  <td>
                    <form action={roleAction} className="row" style={{ gap: 'var(--s-2)' }}>
                      <input type="hidden" name="user_id" value={user.userId} />
                      <select
                        name="role"
                        defaultValue={user.role}
                        aria-label={`دور ${user.displayName}`}
                        style={{ width: 'auto' }}
                        disabled={lastAdmin}
                      >
                        {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn btn-secondary" disabled={lastAdmin}>
                        حفظ
                      </button>
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
