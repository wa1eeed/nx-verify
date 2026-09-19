'use client';

import { useState, type ReactElement, type ReactNode } from 'react';
import { Button, IconButton } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Segmented } from '../ui/segmented';
import { Select } from '../ui/select';
import { SubmitButton } from '../ui/submit-button';
import { bundleReplaceWarningAr, parseWholeNumber, priceField } from './model';

/**
 * The «إضافة» buttons of handoff screen 05 and the edits beside them, each opening a dialog
 * with its form.
 *
 * The dialog closes as the form is sent; the screen comes back with a sentence at its head
 * saying what was saved or why it was refused, where the whole price list can be seen.
 *
 * Words in these dialogs are held to what the action actually does. «إضافة حزمة» used to
 * replace a bundle that already held that many operations, silently, and put a retired one
 * back on sale, and then said «حُفظت».
 */

type Action = (formData: FormData) => Promise<void>;

/** A plan as the terms dialog needs it: the figures it edits, as they stand. */
export interface PlanTermsView {
  code: string;
  nameAr: string;
  billingModel: string;
  platformFeeHalalas: number;
  includedTransactions: number | null;
  overageUnitHalalas: number | null;
  termMonths: number;
  freeReverifyDays: number;
  setupFeeHalalas: number;
  commitmentCreditsHalalas: number;
  overageAllowed: boolean;
}

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

/**
 * «إضافة حزمة», and the replacement it turns into when the count is already taken.
 *
 * A bundle is named after its number of operations, so a second bundle of five hundred is not
 * a second bundle: it is this one, priced differently. The dialog says which of the two is
 * about to happen, before the button is pressed, and carries the code it means to replace so
 * the domain refuses a replacement nobody asked for.
 */
export function BundleDialog({
  action,
  defined,
}: {
  action: Action;
  defined: readonly {
    code: string;
    operations: number;
    priceHalalas: number;
    validityMonths: number;
    retired: boolean;
  }[];
}): ReactElement {
  const [operations, setOperations] = useState('');
  const typed = parseWholeNumber(operations);
  const match = typed === null ? undefined : defined.find((bundle) => bundle.operations === typed);

  return (
    <AddDialog
      button="إضافة حزمة"
      title={match === undefined ? 'إضافة حزمة' : 'استبدال حزمة قائمة'}
      role="add-bundle"
      action={action}
      submit={match === undefined ? 'حفظ الحزمة' : 'استبدال الحزمة'}
    >
      <Field id="bundle-operations" label="عدد العمليات">
        {(control) => (
          <Input
            {...control}
            name="operations"
            inputMode="numeric"
            value={operations}
            onChange={(event) => setOperations(event.target.value)}
            required
            ltr
          />
        )}
      </Field>
      {match === undefined ? null : (
        <p className="field-hint" data-role="bundle-replace-warning" role="status">
          {bundleReplaceWarningAr(match)}
        </p>
      )}
      {match === undefined ? null : <input type="hidden" name="replaces" value={match.code} />}
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

/** The terms every plan carries, as fields, shared by the add dialog and the edit one. */
function PlanTermFields({ plan }: { plan?: PlanTermsView | undefined }): ReactElement {
  const prefix = plan === undefined ? 'plan' : `plan-${plan.code}`;
  return (
    <>
      <Field
        id={`${prefix}-term`}
        label="مدة الالتزام بالأشهر"
        hint="3 أو 12 أو 24 شهراً، وهي المدة التي يوقّع عليها المشترك."
      >
        {(control) => (
          <Select
            {...control}
            name="term_months"
            defaultValue={String(plan?.termMonths ?? 12)}
            required
          >
            <option value="3">3 أشهر</option>
            <option value="12">12 شهراً</option>
            <option value="24">24 شهراً</option>
          </Select>
        )}
      </Field>
      <Field
        id={`${prefix}-free-reverify`}
        label="نافذة إعادة التحقق المجانية بالأيام"
        hint="إعادة التحقق من العميل نفسه خلالها لا تُحسب على المشترك إطلاقاً. صفر يعني أن كل إعادة تحقق تُحسب. تسري على المشتركين الحاليين فور الحفظ."
      >
        {(control) => (
          <Input
            {...control}
            name="free_reverify_days"
            inputMode="numeric"
            defaultValue={String(plan?.freeReverifyDays ?? 30)}
            required
            ltr
          />
        )}
      </Field>
      <Field
        id={`${prefix}-setup-fee`}
        label="رسم التأسيس بالريال"
        hint="يُدفع مرة واحدة عند التوقيع. صفر يعني بلا رسم تأسيس."
      >
        {(control) => (
          <Input
            {...control}
            name="setup_fee"
            inputMode="decimal"
            defaultValue={priceField(plan?.setupFeeHalalas ?? 0)}
            required
            ltr
          />
        )}
      </Field>
      <Field
        id={`${prefix}-commitment-credits`}
        label="الرصيد الممنوح عند التوقيع بالريال"
        hint="يُقيَّد في محفظة المشترك عند بدء المدة."
      >
        {(control) => (
          <Input
            {...control}
            name="commitment_credits"
            inputMode="decimal"
            defaultValue={priceField(plan?.commitmentCreditsHalalas ?? 0)}
            required
            ltr
          />
        )}
      </Field>
      <Field
        id={`${prefix}-overage-allowed`}
        label="بعد نفاد العمليات المشمولة"
        hint="«يتوقف العمل» يمنع كل تحقق جديد حتى تتجدد المدة. يسري على المشتركين الحاليين فور الحفظ."
      >
        {(control) => (
          <Select
            {...control}
            name="overage_allowed"
            defaultValue={plan === undefined || plan.overageAllowed ? 'true' : 'false'}
            required
          >
            <option value="true">يستمر العمل بسعر التجاوز</option>
            <option value="false">يتوقف العمل</option>
          </Select>
        )}
      </Field>
    </>
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
      <PlanTermFields />
    </AddDialog>
  );
}

/**
 * The terms of a plan already on sale.
 *
 * Its fee field says the period the row actually holds: an annual plan's card shows a twelfth
 * of the fee, and writing that figure back would divide the plan's price by twelve.
 */
export function PlanTermsDialog({
  action,
  plan,
}: {
  action: Action;
  plan: PlanTermsView;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const annual = plan.billingModel === 'ANNUAL';
  return (
    <>
      <IconButton
        icon="sliders-horizontal"
        label={`شروط باقة ${plan.nameAr}`}
        data-role="edit-plan"
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onClose={() => setOpen(false)} title={`شروط باقة ${plan.nameAr}`}>
        <form action={action} className="admin-dialog-form" onSubmit={() => setOpen(false)}>
          <input type="hidden" name="code" value={plan.code} />
          <Field
            id={`plan-${plan.code}-fee`}
            label={annual ? 'الرسم السنوي بالريال' : 'الرسم الشهري بالريال'}
            hint={annual ? 'تُعرض على البطاقة مقسومة على 12.' : undefined}
          >
            {(control) => (
              <Input
                {...control}
                name="fee"
                inputMode="decimal"
                defaultValue={priceField(plan.platformFeeHalalas)}
                required
                ltr
              />
            )}
          </Field>
          <Field
            id={`plan-${plan.code}-included`}
            label="العمليات المشمولة شهرياً"
            hint="اتركه فارغاً لباقة حدّها متفاوض عليه لكل مشترك."
          >
            {(control) => (
              <Input
                {...control}
                name="included"
                inputMode="numeric"
                defaultValue={
                  plan.includedTransactions === null ? '' : String(plan.includedTransactions)
                }
                ltr
              />
            )}
          </Field>
          <Field
            id={`plan-${plan.code}-overage`}
            label="سعر التجاوز بالريال"
            hint="لكل عملية بعد المشمولة، ولا ينزل عن تكلفة أغلى تحقق. يُختم عند التوقيع، فتعديله يسري على من يوقّع بعد الآن."
          >
            {(control) => (
              <Input
                {...control}
                name="overage"
                inputMode="decimal"
                defaultValue={priceField(plan.overageUnitHalalas)}
                ltr
              />
            )}
          </Field>
          <PlanTermFields plan={plan} />
          <div className="dialog-actions">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <SubmitButton variant="primary" data-role="edit-plan-submit">
              حفظ الشروط
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
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
