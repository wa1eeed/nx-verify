import type { OperatorAuditRow } from '@nx-verify/core';

/**
 * Who made a change, in words.
 *
 * A member of staff by the name on their account. The deployment's token by what it is. A
 * change recorded before staff had accounts carries the label a script gave itself, which is
 * shown as it was written rather than guessed at.
 */
export function operatorNameOf(row: Pick<OperatorAuditRow, 'operatorId' | 'operatorName'>): string {
  if (row.operatorName !== null) {
    return row.operatorName;
  }
  return row.operatorId === 'nx-staff:token' ? 'مفتاح النشر' : row.operatorId;
}
