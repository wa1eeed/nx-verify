'use client';

import { useState, type ReactElement, type ReactNode } from 'react';
import type { OperatorRole, OperatorStatus } from '@nx-verify/core';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Segmented } from '../ui/segmented';
import { Select } from '../ui/select';
import { SubmitButton } from '../ui/submit-button';

/**
 * The forms of «الصلاحيات والتدقيق», each in a dialog: adding a member of staff, changing one,
 * and changing one's own password. The dialog closes as the form is sent, and the screen comes
 * back saying what was done.
 */

type Action = (formData: FormData) => Promise<void>;

const ROLE_OPTIONS: readonly (readonly [OperatorRole, string])[] = [
  ['OWNER', 'مالك'],
  ['PRICING', 'التسعير'],
  ['SUPPORT', 'الدعم'],
  ['READ_ONLY', 'قراءة فقط'],
];

function FormDialog({
  trigger,
  title,
  action,
  submit,
  role,
  children,
}: {
  trigger: (open: () => void) => ReactNode;
  title: string;
  action: Action;
  submit: string;
  role: string;
  children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        <form action={action} className="admin-dialog-form" onSubmit={() => setOpen(false)}>
          {children}
          <div className="dialog-actions">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <SubmitButton variant="primary" data-role={`${role}-submit`}>
              {submit}
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function RoleSelect({
  id,
  defaultValue,
}: {
  id: string;
  defaultValue: OperatorRole;
}): ReactElement {
  return (
    <Field id={id} label="الدور">
      {(control) => (
        <Select {...control} name="role" defaultValue={defaultValue}>
          {ROLE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export function AddStaffDialog({ action }: { action: Action }): ReactElement {
  return (
    <FormDialog
      title="إضافة عضو إلى الفريق"
      action={action}
      submit="إضافة"
      role="add-staff"
      trigger={(open) => (
        <Button variant="primary" icon="plus" onClick={open} data-role="add-staff">
          إضافة عضو
        </Button>
      )}
    >
      <Field id="staff-name" label="الاسم">
        {(control) => (
          <Input {...control} name="display_name" required minLength={2} maxLength={80} />
        )}
      </Field>
      <Field id="staff-email" label="البريد">
        {(control) => (
          <Input {...control} name="email" type="email" required autoComplete="off" ltr />
        )}
      </Field>
      <RoleSelect id="staff-role" defaultValue="READ_ONLY" />
      <Field
        id="staff-password"
        label="كلمة المرور الأولى"
        hint="12 حرفاً على الأقل. تُسلَّم للعضو ليغيّرها بعد أول دخول."
      >
        {(control) => (
          <Input
            {...control}
            name="password"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            ltr
          />
        )}
      </Field>
    </FormDialog>
  );
}

export function EditStaffDialog({
  action,
  account,
}: {
  action: Action;
  account: { id: string; displayName: string; role: OperatorRole; status: OperatorStatus };
}): ReactElement {
  return (
    <FormDialog
      title={`تعديل ${account.displayName}`}
      action={action}
      submit="حفظ"
      role="edit-staff"
      trigger={(open) => (
        <Button variant="ghost" onClick={open} data-role="edit-staff">
          تعديل
        </Button>
      )}
    >
      <input type="hidden" name="id" value={account.id} />
      <RoleSelect id={`role-${account.id}`} defaultValue={account.role} />
      <Segmented
        name="status"
        label="الحالة"
        defaultValue={account.status}
        options={[
          { value: 'ACTIVE', label: 'مفعّل' },
          { value: 'DISABLED', label: 'موقوف' },
        ]}
      />
      <Field
        id={`password-${account.id}`}
        label="كلمة مرور جديدة"
        hint="اتركها فارغة لتبقى كما هي."
      >
        {(control) => (
          <Input
            {...control}
            name="password"
            type="password"
            minLength={12}
            autoComplete="new-password"
            ltr
          />
        )}
      </Field>
    </FormDialog>
  );
}

export function OwnPasswordDialog({ action }: { action: Action }): ReactElement {
  return (
    <FormDialog
      title="تغيير كلمة المرور"
      action={action}
      submit="تغيير"
      role="own-password"
      trigger={(open) => (
        <Button onClick={open} data-role="own-password">
          تغيير كلمة المرور
        </Button>
      )}
    >
      <Field id="current-password" label="كلمة المرور الحالية">
        {(control) => (
          <Input
            {...control}
            name="current"
            type="password"
            required
            autoComplete="current-password"
            ltr
          />
        )}
      </Field>
      <Field id="next-password" label="كلمة المرور الجديدة" hint="12 حرفاً على الأقل.">
        {(control) => (
          <Input
            {...control}
            name="next"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            ltr
          />
        )}
      </Field>
    </FormDialog>
  );
}
