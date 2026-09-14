'use client';

import { useActionState, useState, type ReactElement } from 'react';
import { Button, ButtonLink } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Ltr } from '../ui/ltr';
import { Notice } from '../ui/notice';
import { Select } from '../ui/select';
import { SubmitButton } from '../ui/submit-button';

/**
 * «مشترك جديد» (handoff screen 06): a workspace, its first administrator and its plan.
 *
 * The answer comes back to the dialog rather than to the address, because it carries the
 * administrator's temporary password, which is shown here once and nowhere else: not in the
 * address, not in the trail, not in the database in a form anybody can read.
 */

export type NewSubscriberState =
  | { ok: true; tenantId: string; slug: string; adminEmail: string; temporaryPassword: string }
  | { ok: false; messageAr: string }
  | null;

export function NewSubscriberDialog({
  action,
  plans,
}: {
  action: (state: NewSubscriberState, formData: FormData) => Promise<NewSubscriberState>;
  plans: readonly { code: string; nameAr: string }[];
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, null);
  const made = state !== null && state.ok ? state : null;

  return (
    <>
      <Button
        variant="primary"
        icon="plus"
        onClick={() => setOpen(true)}
        data-role="new-subscriber"
      >
        مشترك جديد
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="مشترك جديد">
        {made !== null ? (
          <div className="admin-dialog-form" data-role="new-subscriber-made">
            <Notice tone="done">
              أُنشئ المشترك ومساحة عمله <Ltr>{made.slug}</Ltr>، وحساب مسؤوله{' '}
              <Ltr>{made.adminEmail}</Ltr>.
            </Notice>
            <div className="field">
              <span className="admin-secret-label">كلمة المرور المؤقتة</span>
              <p className="admin-secret" data-role="temporary-password">
                <Ltr>{made.temporaryPassword}</Ltr>
              </p>
              <p className="field-hint">
                انسخها الآن وسلّمها للمسؤول: لن تظهر مرة أخرى، ويُطلب منه تغييرها عند أول دخول.
              </p>
            </div>
            <div className="dialog-actions">
              <ButtonLink href={`/operator/subscribers/${made.tenantId}`}>فتح المشترك</ButtonLink>
              <Button variant="primary" onClick={() => setOpen(false)}>
                تم
              </Button>
            </div>
          </div>
        ) : (
          <form action={formAction} className="admin-dialog-form">
            {state !== null && !state.ok ? (
              <Notice tone="refused" role="new-subscriber-refused">
                {state.messageAr}
              </Notice>
            ) : null}
            <Field id="subscriber-name" label="اسم المنشأة">
              {(control) => (
                <Input {...control} name="legal_name" required minLength={2} maxLength={120} />
              )}
            </Field>
            <Field
              id="subscriber-slug"
              label="اسم مساحة العمل"
              hint="حروف لاتينية صغيرة وأرقام وشرطة، من 3 إلى 40. يدخل به فريق المشترك."
            >
              {(control) => (
                <Input
                  {...control}
                  name="slug"
                  required
                  pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
                  autoComplete="off"
                  ltr
                />
              )}
            </Field>
            <Field id="subscriber-admin-email" label="بريد المسؤول">
              {(control) => (
                <Input
                  {...control}
                  name="admin_email"
                  type="email"
                  required
                  autoComplete="off"
                  ltr
                />
              )}
            </Field>
            <Field id="subscriber-admin-name" label="اسم المسؤول" hint="اختياري.">
              {(control) => <Input {...control} name="admin_name" maxLength={80} />}
            </Field>
            <Field id="subscriber-plan" label="الباقة">
              {(control) => (
                <Select {...control} name="package_code" required defaultValue="">
                  <option value="" disabled>
                    اختر باقة
                  </option>
                  {plans.map((plan) => (
                    <option key={plan.code} value={plan.code}>
                      {plan.nameAr}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="dialog-actions">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                إلغاء
              </Button>
              <SubmitButton
                variant="primary"
                pendingLabel="جارٍ الإنشاء"
                data-role="new-subscriber-submit"
              >
                إنشاء المشترك
              </SubmitButton>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
