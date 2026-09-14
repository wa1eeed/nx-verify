'use client';

import { useState, type ReactElement, type ReactNode } from 'react';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Segmented } from '../ui/segmented';
import { Select } from '../ui/select';
import { SubmitButton } from '../ui/submit-button';

/**
 * The three «إضافة» buttons of handoff screen 05, each opening a dialog with its form.
 *
 * The dialog closes as the form is sent; the screen comes back with a sentence at its head
 * saying what was saved or why it was refused, where the whole price list can be seen.
 */

type Action = (formData: FormData) => Promise<void>;

function AddDialog({
  button,
  title,
  role,
  action,
  submit,
  children,
}: {
  button: string;
  title: string;
  role: string;
  action: Action;
  submit: string;
  children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button block onClick={() => setOpen(true)} data-role={role}>
        {button}
      </Button>
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

export function AddBundleDialog({ action }: { action: Action }): ReactElement {
  return (
    <AddDialog
      button="إضافة حزمة"
      title="إضافة حزمة"
      role="add-bundle"
      action={action}
      submit="حفظ الحزمة"
    >
      <Field id="bundle-operations" label="عدد العمليات">
        {(control) => <Input {...control} name="operations" inputMode="numeric" required ltr />}
      </Field>
      <Field
        id="bundle-price"
        label="السعر بالريال"
        hint="بلا ضريبة. سعر العملية الواحدة لا ينزل عن تكلفة أغلى تحقق."
      >
        {(control) => <Input {...control} name="price" inputMode="decimal" required ltr />}
      </Field>
      <Field id="bundle-months" label="مدة الصلاحية بالأشهر">
        {(control) => (
          <Input
            {...control}
            name="validity_months"
            inputMode="numeric"
            defaultValue="12"
            required
            ltr
          />
        )}
      </Field>
    </AddDialog>
  );
}

export function AddPlanDialog({ action }: { action: Action }): ReactElement {
  return (
    <AddDialog
      button="إضافة باقة"
      title="إضافة باقة"
      role="add-plan"
      action={action}
      submit="حفظ الباقة"
    >
      <Field id="plan-name-ar" label="اسم الباقة">
        {(control) => <Input {...control} name="name_ar" required minLength={2} />}
      </Field>
      <Field id="plan-name-en" label="الاسم بالإنجليزية">
        {(control) => <Input {...control} name="name_en" required minLength={2} ltr />}
      </Field>
      <Field id="plan-code" label="الرمز" hint="حروف لاتينية كبيرة وأرقام، مثل GROWTH_PLUS.">
        {(control) => (
          <Input {...control} name="code" required pattern="[A-Za-z][A-Za-z0-9_]{1,31}" ltr />
        )}
      </Field>
      <Field id="plan-fee" label="الرسم الشهري بالريال">
        {(control) => <Input {...control} name="monthly_fee" inputMode="decimal" required ltr />}
      </Field>
      <Field id="plan-included" label="العمليات المشمولة شهرياً">
        {(control) => <Input {...control} name="included" inputMode="numeric" required ltr />}
      </Field>
      <Field
        id="plan-overage"
        label="سعر التجاوز بالريال"
        hint="لكل عملية بعد المشمولة. لا ينزل عن تكلفة أغلى تحقق."
      >
        {(control) => <Input {...control} name="overage" inputMode="decimal" required ltr />}
      </Field>
    </AddDialog>
  );
}

export function SpecialPriceDialog({
  action,
  subscribers,
  products,
}: {
  action: Action;
  subscribers: readonly { tenantId: string; legalName: string }[];
  products: readonly { code: string; nameAr: string }[];
}): ReactElement {
  const [kind, setKind] = useState<'product' | 'discount'>('product');
  return (
    <AddDialog
      button="إضافة سعر خاص"
      title="إضافة سعر خاص"
      role="add-special-price"
      action={action}
      submit="حفظ السعر الخاص"
    >
      <Field id="special-tenant" label="المشترك">
        {(control) => (
          <Select {...control} name="tenant_id" required defaultValue="">
            <option value="" disabled>
              اختر مشتركاً
            </option>
            {subscribers.map((subscriber) => (
              <option key={subscriber.tenantId} value={subscriber.tenantId}>
                {subscriber.legalName}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Segmented
        name="kind"
        label="نوع السعر الخاص"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'product', label: 'سعر لمنتج' },
          { value: 'discount', label: 'خصم على كل المنتجات' },
        ]}
      />
      {kind === 'product' ? (
        <>
          <Field id="special-product" label="المنتج">
            {(control) => (
              <Select {...control} name="product_code" required>
                {products.map((product) => (
                  <option key={product.code} value={product.code}>
                    {product.nameAr}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            id="special-price"
            label="السعر بالريال"
            hint="اتركه فارغاً لإلغاء السعر الخاص لهذا المنتج."
          >
            {(control) => <Input {...control} name="price" inputMode="decimal" ltr />}
          </Field>
        </>
      ) : (
        <Field
          id="special-discount"
          label="نسبة الخصم"
          hint="اتركها فارغة لإلغاء الخصم. لا ينزل الخصم بأي منتج عن تكلفته."
        >
          {(control) => <Input {...control} name="discount_pct" inputMode="decimal" ltr />}
        </Field>
      )}
    </AddDialog>
  );
}
