import type { ReactElement } from 'react';
import { withTenant } from '@nx-verify/db';
import { ChangePassword } from '../../../components/change-password';
import { getPool, sessionForPasswordChange } from '../../../lib/context';
import { changePasswordAction } from './actions';

/** Never prerendered: it reads the session and writes a credential. */
export const dynamic = 'force-dynamic';

const FAILED = 'تعذّر تغيير كلمة المرور. تحقق من الحالية، ومن أن الجديدة اثنتا عشرة خانة على الأقل.';

export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const session = await sessionForPasswordChange();

  // Whether this is the forced change or a voluntary one, so the screen can say why the
  // person is looking at it.
  const { rows } = await withTenant(getPool(), session.tenantId, (tx) =>
    tx.query<{ must_change: boolean }>(
      `SELECT must_change FROM user_credentials WHERE tenant_id = $1 AND user_id = $2`,
      [tx.tenantId, session.userId],
    ),
  );

  return (
    <ChangePassword
      error={params['error'] === undefined ? null : FAILED}
      forced={rows[0]?.must_change ?? false}
      action={changePasswordAction}
    />
  );
}
