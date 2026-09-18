import type { ReactElement } from 'react';
import { CAPABILITIES, type Capability, type CapabilityArea } from '@nx-verify/core';
import { SubmitButton } from './ui/submit-button';

/**
 * One person's permissions, opened from the row that lists them.
 *
 * The design problem this screen has is that fourteen switches in a column is a form nobody
 * fills in correctly. So the role above it does the work: picking «المالية» sets thirteen of
 * the fourteen, and what is left is the one or two a particular company wants different.
 * Those show as exceptions, marked, because an exception somebody made months ago and forgot
 * is how a permissions screen quietly stops describing reality.
 *
 * Three decisions worth naming.
 *
 * **The preset is always visible beside the switch.** «مفعّل» tells you the state; «حسب الدور»
 * tells you why, and whether turning it off is a change or a return. Without it, an
 * administrator cannot tell an exception from a default and stops trusting either.
 *
 * **What spends money is marked.** Two of these let somebody start work that draws on the
 * balance. That is the one thing on this screen an administrator should slow down for, and
 * a warning on the two that matter is read where a warning on all fourteen is not.
 *
 * **It is a `details` element, not a dialog.** Several people can be open at once, it
 * survives without JavaScript, the browser's find-in-page reaches inside it, and nothing has
 * to be remembered about which person was being edited when the form posts.
 */

const AREA_LABELS: Record<CapabilityArea, string> = {
  customers: 'العملاء والمراجعة',
  verify: 'التحقق',
  billing: 'الرصيد والفواتير',
  settings: 'الإعدادات والربط',
};

const AREA_ORDER: readonly CapabilityArea[] = ['customers', 'verify', 'billing', 'settings'];

export interface PermissionView {
  code: Capability;
  /** Whether they hold it right now. */
  held: boolean;
  /** Whether their role carries it, which is what makes `held` an exception or a default. */
  preset: boolean;
}

export function permissionsOf(
  held: ReadonlySet<Capability>,
  preset: ReadonlySet<Capability>,
): PermissionView[] {
  return CAPABILITIES.map((entry) => ({
    code: entry.code,
    held: held.has(entry.code),
    preset: preset.has(entry.code),
  }));
}

export function UserPermissions({
  userId,
  displayName,
  roleLabel,
  permissions,
  action,
  resetAction,
  disabled = false,
}: {
  userId: string;
  displayName: string;
  roleLabel: string;
  permissions: PermissionView[];
  action: (formData: FormData) => void | Promise<void>;
  resetAction: (formData: FormData) => void | Promise<void>;
  /** True for a disabled account, which holds nothing until it is enabled again. */
  disabled?: boolean;
}): ReactElement {
  const exceptions = permissions.filter((item) => item.held !== item.preset);

  return (
    <details className="stack permissions" data-role="permissions" data-user={userId}>
      <summary>
        <span>الصلاحيات</span>
        {exceptions.length > 0 ? (
          <span className="badge" data-tone="accent" data-role="exception-count">
            {exceptions.length} استثناء
          </span>
        ) : (
          <span className="faint">حسب الدور</span>
        )}
      </summary>

      <div className="stack" style={{ gap: 'var(--s-4)', paddingBlockStart: 'var(--s-3)' }}>
        <p className="stat-hint" style={{ margin: 0 }}>
          {disabled ? (
            <>
              هذا الحساب معطّل ولا يملك أي صلاحية حتى يُعاد تفعيله. ما تضبطه هنا يسري عند
              إعادة التفعيل.
            </>
          ) : (
            <>
              دور {displayName} هو «{roleLabel}»، وهذه الصلاحيات تأتي منه. ما تغيّره هنا استثناء
              لهذا الشخص وحده، ويبقى معه حتى لو تغيّر دوره.
            </>
          )}
        </p>

        {AREA_ORDER.map((area) => {
          const inArea = CAPABILITIES.filter((entry) => entry.area === area);
          return (
            <section key={area} className="stack" style={{ gap: 'var(--s-2)' }}>
              <span className="stat-label">{AREA_LABELS[area]}</span>
              {inArea.map((entry) => {
                const state = permissions.find((item) => item.code === entry.code);
                const held = state?.held ?? false;
                const preset = state?.preset ?? false;
                const isException = held !== preset;

                return (
                  <form
                    key={entry.code}
                    action={action}
                    className="row permission-row"
                    data-role="permission"
                    data-capability={entry.code}
                    data-held={held ? 'true' : 'false'}
                    data-exception={isException ? 'true' : 'false'}
                    style={{ gap: 'var(--s-3)', alignItems: 'baseline', flexWrap: 'wrap' }}
                  >
                    <input type="hidden" name="user_id" value={userId} />
                    <input type="hidden" name="capability" value={entry.code} />

                    <div className="stack" style={{ gap: 0, flex: 1, minWidth: '240px' }}>
                      <span className="row" style={{ gap: 'var(--s-2)', alignItems: 'baseline' }}>
                        <strong>{entry.nameAr}</strong>
                        {entry.spends ? (
                          <span className="badge" data-tone="accent" data-role="spends">
                            يصرف من الرصيد
                          </span>
                        ) : null}
                        {isException ? (
                          <span className="badge" data-tone="accent" data-role="exception">
                            استثناء
                          </span>
                        ) : null}
                      </span>
                      <span className="faint">{entry.summaryAr}</span>
                    </div>

                    <span className="faint" data-role="preset">
                      {preset ? 'الدور يمنحها' : 'الدور لا يمنحها'}
                    </span>

                    <input type="hidden" name="granted" value={held ? 'false' : 'true'} />
                    <SubmitButton
                      variant={held ? 'ghost' : 'secondary'}
                      data-role={held ? 'revoke' : 'grant'}
                      pendingLabel="جارٍ الحفظ"
                    >
                      {held ? 'اسحبها' : 'امنحها'}
                    </SubmitButton>
                  </form>
                );
              })}
            </section>
          );
        })}

        {exceptions.length > 0 ? (
          <form action={resetAction} className="row" style={{ gap: 'var(--s-3)' }}>
            <input type="hidden" name="user_id" value={userId} />
            <SubmitButton variant="ghost" data-role="reset-permissions" pendingLabel="جارٍ الحفظ">
              أعِد كل الصلاحيات إلى الدور
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </details>
  );
}
