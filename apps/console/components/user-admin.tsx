import type { ReactElement } from 'react';
import type { UserRole } from '@nx-verify/core';

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

export const ROLE_LABELS: Record<UserRole, string> = {
  VIEWER: 'مطّلع',
  ANALYST: 'محلل',
  APPROVER: 'معتمِد',
  ADMIN: 'مسؤول',
};

const ROLE_HINTS: Record<UserRole, string> = {
  VIEWER: 'يقرأ الملفات ولا يغيّر شيئاً',
  ANALYST: 'يشغّل التحقق ويبتّ في حالات المراجعة',
  APPROVER: 'يعتمد ما بتّ فيه المحلل',
  ADMIN: 'كل ما سبق، ويدير المستخدمين والمفاتيح والإعدادات',
};

export interface UserAdminProps {
  users: UserRowView[];
  /** How many administrators are still active. The last one cannot be removed. */
  activeAdmins: number;
  /** Present for one render, straight after creating an account. */
  issuedPassword?: { email: string; password: string } | null;
  createAction: string | ((formData: FormData) => void | Promise<void>);
  roleAction: string | ((formData: FormData) => void | Promise<void>);
  statusAction: string | ((formData: FormData) => void | Promise<void>);
}

export function UserAdmin({
  users,
  activeAdmins,
  issuedPassword = null,
  createAction,
  roleAction,
  statusAction,
}: UserAdminProps): ReactElement {
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      {issuedPassword ? (
        <section
          className="card stack"
          data-role="issued-password"
          style={{
            gap: 'var(--s-2)',
            border: '1px solid var(--fresh-line)',
            background: 'var(--fresh-bg)',
          }}
        >
          <strong>كلمة مرور مؤقتة لـ {issuedPassword.email}</strong>
          <code className="mono" dir="ltr" data-role="temporary-password">
            {issuedPassword.password}
          </code>
          <span className="stat-hint">
            سلّمها بقناة تثق بها، ولن تُعرض مرة أخرى. سيُطلب منه تغييرها عند أول دخول، فلن
            تعرف أنت كلمة مروره بعدها.
          </span>
        </section>
      ) : null}

      <section className="card stack" data-role="invite" style={{ gap: 'var(--s-3)' }}>
        <div>
          <h2 style={{ margin: 0 }}>إضافة شخص</h2>
          <p className="faint" style={{ margin: 0 }}>
            يدخل ببريده وكلمة مرور مؤقتة، ويغيّرها عند أول دخول.
          </p>
        </div>
        <form action={createAction} className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
          <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '200px' }}>
            <span className="stat-label">البريد</span>
            <input name="email" type="email" dir="ltr" className="mono" required />
          </label>
          <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '160px' }}>
            <span className="stat-label">الاسم</span>
            <input name="display_name" required />
          </label>
          <label className="stack" style={{ gap: 'var(--s-1)' }}>
            <span className="stat-label">الدور</span>
            <select name="role" defaultValue="ANALYST" style={{ width: 'auto' }}>
              {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn-primary" data-role="create-user">
            إضافة
          </button>
        </form>
        <ul className="stack faint" style={{ gap: 'var(--s-1)', margin: 0 }}>
          {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
            <li key={role}>
              <strong>{ROLE_LABELS[role]}</strong>: {ROLE_HINTS[role]}
            </li>
          ))}
        </ul>
      </section>

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
                      <button type="submit" className="btn-secondary" disabled={lastAdmin}>
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
                          className="btn-secondary"
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
