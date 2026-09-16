import type { ReactElement } from 'react';
import type { MailSettings } from '@nx-verify/core';
import { Card } from './ui/card';
import { Field } from './ui/field';
import { Input } from './ui/input';
import { Ltr } from './ui/ltr';
import { Notice } from './ui/notice';
import { Select } from './ui/select';
import { SubmitButton } from './ui/submit-button';
import { Tag } from './ui/tag';
import { PageHeader } from './page-header';
import { dateAr, timeOfDay } from './format';

/**
 * How mail leaves this deployment (ADR-141).
 *
 * The queue behind it has worked since the notifications unit; what was missing was a way to
 * point it at a mail service without a deployment and a restart. So the address, the name and
 * which service carries it are set here.
 *
 * The key is not shown back, ever. The screen learns only whether one is stored and a
 * fingerprint of it, exactly as the data source's credentials are handled: a field left empty
 * keeps what is already there, so correcting an address never means pasting a key again.
 */

export interface MailView {
  settings: MailSettings;
  /** What the secret store will say about the stored key: never its value. */
  key: { updatedAt: Date | null; fingerprint: string | null } | null;
  /** A read only store cannot be given a key, so the screen does not pretend it can. */
  secretsWritable: boolean;
  canEdit: boolean;
  notice: { tone: 'done' | 'refused'; text: string } | null;
}

const PROVIDER_LABELS: Readonly<Record<MailSettings['provider'], string>> = {
  none: 'لا تُرسَل رسائل',
  resend: 'Resend',
  http: 'خدمة أخرى عبر HTTPS',
};

export function OperatorMail({
  view,
  saveAction,
  testAction,
}: {
  view: MailView;
  saveAction: (formData: FormData) => void | Promise<void>;
  testAction: (formData: FormData) => void | Promise<void>;
}): ReactElement {
  const { settings } = view;

  return (
    <div className="admin-screen" data-role="operator-mail">
      <PageHeader
        title="البريد"
        subtitle="من أين تخرج رسائل المنصة، وباسم من. الإشعارات والتنبيهات وروابط المشاركة كلها تمر من هنا."
      />

      {view.notice === null ? null : (
        <Notice tone={view.notice.tone} role="mail-notice">
          {view.notice.text}
        </Notice>
      )}

      <section className="grid" data-role="mail-tiles">
        <article className="stat" {...(settings.configured ? {} : { 'data-tone': 'changed' })}>
          <span className="stat-label">الحالة</span>
          <strong className="stat-value">{settings.configured ? 'جاهز' : 'غير مضبوط'}</strong>
          <span className="stat-hint">
            {settings.configured
              ? 'الرسائل تخرج خلال دقيقة من وقوع الحدث'
              : 'الرسائل تُحفظ في الطابور ولا تخرج'}
          </span>
        </article>
        <article className="stat">
          <span className="stat-label">آخر إرسال ناجح</span>
          <strong className="stat-value">
            {settings.lastSentAt === null ? '·' : <Ltr>{timeOfDay(settings.lastSentAt)}</Ltr>}
          </strong>
          <span className="stat-hint">
            {settings.lastSentAt === null ? 'لم تُرسَل رسالة بعد' : dateAr(settings.lastSentAt)}
          </span>
        </article>
        <article
          className="stat"
          {...(settings.lastError === null ? {} : { 'data-tone': 'changed' })}
        >
          <span className="stat-label">آخر خطأ</span>
          <strong className="stat-value">{settings.lastError === null ? 'لا شيء' : 'يوجد'}</strong>
          <span className="stat-hint">
            {settings.lastError ?? 'لم ترفض الخدمة رسالة منذ آخر ضبط'}
          </span>
        </article>
      </section>

      <Card role="mail-settings" labelledBy="mail-settings-title">
        <div className="admin-card-head">
          <h2 className="card-title admin-card-title" id="mail-settings-title">
            خدمة الإرسال
          </h2>
          <div className="admin-head-actions">
            <Tag tone={settings.hasKey ? 'accent-2' : 'neutral'}>
              {settings.hasKey ? 'المفتاح محفوظ' : 'لا مفتاح'}
            </Tag>
            {view.key?.fingerprint === null || view.key === null ? null : (
              <Tag tone="neutral">
                <Ltr>{view.key.fingerprint}</Ltr>
              </Tag>
            )}
          </div>
        </div>

        <p className="admin-card-note">
          المفتاح يُحفظ في خزنة الأسرار لا في قاعدة البيانات، ولا يُعرض هنا مرة أخرى مهما كان. اترك
          حقله فارغاً ليبقى المحفوظ كما هو، واكتب فيه لتستبدله.
        </p>

        {view.secretsWritable ? null : (
          <Notice tone="refused" role="mail-readonly">
            خزنة الأسرار في هذا النشر للقراءة فقط، فلا يمكن حفظ مفتاح من الشاشة. اضبطه حيث تُضبط
            أسرار النشر.
          </Notice>
        )}

        {view.canEdit && view.secretsWritable ? (
          <form action={saveAction}>
            <div className="admin-settings-fields">
              <Field id="mail-provider" label="الخدمة">
                {(control) => (
                  <Select {...control} name="provider" defaultValue={settings.provider}>
                    {(['none', 'resend', 'http'] as const).map((provider) => (
                      <option key={provider} value={provider}>
                        {PROVIDER_LABELS[provider]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                id="mail-from"
                label="تُرسَل من عنوان"
                hint="عنوان على نطاق تملكه وتوثّقه لدى الخدمة."
              >
                {(control) => (
                  <Input
                    {...control}
                    name="from_address"
                    defaultValue={settings.fromAddress ?? ''}
                    inputMode="email"
                    ltr
                  />
                )}
              </Field>
              <Field id="mail-from-name" label="باسم" hint="ما يراه القارئ بجانب العنوان.">
                {(control) => (
                  <Input {...control} name="from_name" defaultValue={settings.fromName ?? ''} />
                )}
              </Field>
              <Field
                id="mail-reply"
                label="الرد يذهب إلى"
                hint="اختياري. اتركه فارغاً ليكون الرد على عنوان المرسِل."
              >
                {(control) => (
                  <Input
                    {...control}
                    name="reply_to"
                    defaultValue={settings.replyTo ?? ''}
                    inputMode="email"
                    ltr
                  />
                )}
              </Field>
              <Field
                id="mail-endpoint"
                label="عنوان الخدمة"
                hint="لخدمة غير Resend فقط. يبدأ بـ https."
              >
                {(control) => (
                  <Input {...control} name="endpoint" defaultValue={settings.endpoint ?? ''} ltr />
                )}
              </Field>
              <Field
                id="mail-key"
                label="مفتاح الخدمة"
                hint={settings.hasKey ? 'محفوظ. اكتب هنا لاستبداله.' : 'مطلوب عند أول ضبط.'}
              >
                {(control) => (
                  <Input
                    {...control}
                    name="api_key"
                    type="password"
                    autoComplete="off"
                    placeholder={settings.hasKey ? '••••••••' : ''}
                    ltr
                  />
                )}
              </Field>
            </div>
            <SubmitButton data-role="save-mail" pendingLabel="جارٍ الحفظ">
              حفظ
            </SubmitButton>
          </form>
        ) : (
          <p className="admin-card-note" data-role="mail-readonly-summary">
            {PROVIDER_LABELS[settings.provider]}
            {settings.fromAddress === null ? null : (
              <>
                {' · '}
                <Ltr>{settings.fromAddress}</Ltr>
              </>
            )}
          </p>
        )}
      </Card>

      {view.canEdit && settings.configured ? (
        <Card role="mail-test" labelledBy="mail-test-title">
          <h2 className="card-title admin-card-title" id="mail-test-title">
            جرّب الإرسال
          </h2>
          <p className="admin-card-note">
            رسالة واحدة إلى عنوان تكتبه، بالمحوّل نفسه الذي يرسل به العامل. ما يثبت أن الضبط صحيح هو
            رسالة وصلت، لا نموذج حُفظ.
          </p>
          <form action={testAction} className="admin-settings-fields">
            <Field id="mail-test-to" label="إلى">
              {(control) => <Input {...control} name="to" inputMode="email" required ltr />}
            </Field>
            <SubmitButton variant="secondary" data-role="test-mail" pendingLabel="جارٍ الإرسال">
              أرسل رسالة تجربة
            </SubmitButton>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
