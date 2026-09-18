import type { ReactElement } from 'react';
import type { CustomerKind, PlatformSettings, ProfileSection } from '@nx-verify/core';
import { Card } from '../ui/card';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Tag } from '../ui/tag';
import { TagToggle } from '../ui/tag-toggle';
import { KIND_HEADINGS, SECTION_TAGS, daysField, optionalTagAr } from './model';

/**
 * «إعدادات التحقق» (handoff screen 05): four figures, and the sections each kind of file needs.
 *
 * Rendered on the prices screen, where the handoff draws it, and on the verification settings
 * screen, where the navigation leads. Its fields belong to a form elsewhere on the screen,
 * named by id, so the one «حفظ التغييرات» in the screen's head saves them.
 */

export interface SectionTagView {
  section: ProfileSection;
  requirement: 'REQUIRED' | 'OPTIONAL';
  /** The anchor of every file, which stays required (ADR-114). */
  fixed: boolean;
}

export type SectionsView = Readonly<Record<CustomerKind, readonly SectionTagView[]>>;

const KIND_NAMES: Readonly<Record<CustomerKind, string>> = {
  COMPANY: 'الشركة',
  ESTABLISHMENT: 'المؤسسة',
  FREELANCER: 'العامل الحر',
};

export function VerificationSettings({
  settings,
  sections,
  formId,
  editable,
}: {
  settings: Pick<
    PlatformSettings,
    | 'maxAttempts'
    | 'resultValidityDays'
    | 'nameMatchThresholdPct'
    | 'registryAlertDays'
    | 'userSecondStep'
    | 'bankAccountName'
    | 'bankName'
    | 'bankIban'
    | 'transferNote'
  >;
  sections: SectionsView;
  formId: string;
  editable: boolean;
}): ReactElement {
  const fields: readonly (readonly [string, string, string])[] = [
    ['max_attempts', 'عدد المحاولات عند الفشل', String(settings.maxAttempts)],
    ['result_validity_days', 'مدة صلاحية نتيجة التحقق', daysField(settings.resultValidityDays)],
    ['name_match_threshold_pct', 'حد تطابق الاسم المقبول', `${settings.nameMatchThresholdPct}%`],
    ['registry_alert_days', 'تنبيه انتهاء السجل قبل', daysField(settings.registryAlertDays)],
  ];

  /**
   * The account subscribers transfer to (ADR-158).
   *
   * Here rather than in the deployment's environment, where changing a bank account meant a
   * redeployment and the person who knows the number could not reach the field. Not a secret:
   * it is printed on the screen of every subscriber who buys credit.
   */
  const bankFields: readonly (readonly [string, string, string, string])[] = [
    ['bank_account_name', 'اسم الحساب', settings.bankAccountName ?? '', 'كما هو لدى البنك'],
    ['bank_name', 'البنك', settings.bankName ?? '', ''],
    ['bank_iban', 'الآيبان', settings.bankIban ?? '', 'SA ثم 22 رقماً'],
    ['transfer_note', 'ملاحظة تظهر مع بيانات التحويل', settings.transferNote ?? '', ''],
  ];

  return (
    <Card role="verification-settings" labelledBy="verification-settings-title">
      <h2 className="card-title admin-card-title" id="verification-settings-title">
        إعدادات التحقق
      </h2>
      {editable ? <input type="hidden" form={formId} name="settings_present" value="1" /> : null}

      <div className="admin-settings-fields" data-role="bank-settings">
        {bankFields.map(([name, label, value, hint]) => (
          <Field key={name} id={name} label={label}>
            {(control) => (
              <Input
                {...control}
                form={formId}
                name={name}
                defaultValue={value}
                placeholder={hint}
                disabled={!editable}
                ltr={name === 'bank_iban'}
              />
            )}
          </Field>
        ))}
      </div>

      <div className="admin-settings-fields">
        {editable ? (
          <label className="check" htmlFor="user_second_step">
            <input
              id="user_second_step"
              type="checkbox"
              name="user_second_step"
              value="email"
              form={formId}
              defaultChecked={settings.userSecondStep === 'email'}
            />
            <span className="box" aria-hidden="true" />
            <span>
              رمز بالبريد لمستخدمي المشتركين بعد كلمة المرور
              <span className="admin-offer-terms">
                {' · '}
                لا تُفعّله قبل أن تصل رسالة تجربة من شاشة البريد: الدخول يتوقف إن تعذّر الإرسال
              </span>
            </span>
          </label>
        ) : (
          <p className="admin-card-note">
            {settings.userSecondStep === 'email'
              ? 'مستخدمو المشتركين يُطلب منهم رمز بالبريد بعد كلمة المرور.'
              : 'مستخدمو المشتركين يدخلون بكلمة المرور وحدها.'}
          </p>
        )}
        {fields.map(([name, label, value]) => (
          <Field key={name} id={name} label={label}>
            {(control) => (
              <Input
                {...control}
                form={formId}
                name={name}
                defaultValue={value}
                inputMode="numeric"
                required
                disabled={!editable}
              />
            )}
          </Field>
        ))}
      </div>

      <hr className="admin-divider" />

      <div className="admin-sections">
        {KIND_HEADINGS.map(([kind, heading]) => (
          <div key={kind} data-role={`sections-${kind.toLowerCase()}`}>
            <p className="admin-sections-heading">{heading}</p>
            <div className="admin-tags">
              {sections[kind].map((row) => {
                const tag = SECTION_TAGS[row.section];
                if (row.fixed || !editable) {
                  return row.requirement === 'REQUIRED' ? (
                    <Tag key={row.section} tone="brand">
                      {tag.name}
                    </Tag>
                  ) : (
                    <Tag key={row.section} tone="neutral">
                      {optionalTagAr(row.section)}
                    </Tag>
                  );
                }
                return (
                  <span key={row.section} className="admin-tag-slot">
                    <input
                      type="hidden"
                      form={formId}
                      name={`listed:${kind}:${row.section}`}
                      value="1"
                    />
                    <TagToggle
                      name={`required:${kind}`}
                      value={row.section}
                      form={formId}
                      defaultChecked={row.requirement === 'REQUIRED'}
                      on={tag.name}
                      off={optionalTagAr(row.section)}
                      onTone="accent"
                      offTone="neutral"
                      label={`${tag.name} مطلوب في ملف ${KIND_NAMES[kind]}`}
                      role={`section-${kind.toLowerCase()}-${row.section.toLowerCase()}`}
                    />
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
