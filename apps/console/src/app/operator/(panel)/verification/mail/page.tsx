import type { ReactElement } from 'react';
import { getMailSettings, operatorCan } from '@nx-verify/core';
import { secretStoreFromEnv } from '@nx-verify/providers';
import { OperatorMail } from '../../../../../components/operator-mail';
import { SectionTabs } from '../../../../../components/section-tabs';
import { INTEGRATION_TABS } from '../../../../../components/operator-shell';
import { operatorOrSignIn, operatorQuery } from '../../../../../lib/operator';
import { saveMailAction, testMailAction } from './actions';

/** Never prerendered, and refuses to render without a sign in. */
export const dynamic = 'force-dynamic';

const NOTICES: Readonly<Record<string, { tone: 'done' | 'refused'; text: string }>> = {
  saved: { tone: 'done', text: 'حُفظ الضبط. الرسائل تخرج من الدقيقة القادمة بلا إعادة تشغيل.' },
  cleared: {
    tone: 'done',
    text: 'أُوقف الإرسال. الرسائل تبقى في الطابور ويمكن قراءتها في الكونسول.',
  },
  sent: { tone: 'done', text: 'وصلت الرسالة إلى الخدمة. تحقق من صندوق الوارد.' },
  'refused:invalid': {
    tone: 'refused',
    text: 'لم يُحفظ: العنوان غير صالح، أو الخدمة تحتاج عنواناً يبدأ بـ https، أو ينقص المفتاح.',
  },
  'refused:readonly': {
    tone: 'refused',
    text: 'خزنة الأسرار في هذا النشر للقراءة فقط، فلا يمكن حفظ مفتاح من الشاشة.',
  },
  'refused:send': {
    tone: 'refused',
    text: 'لم تصل الرسالة. السبب مكتوب في بطاقة «آخر خطأ» أعلاه.',
  },
};

/**
 * How mail leaves this deployment (ADR-141): the service, the address it sends from, and a
 * test that proves it rather than a form that was saved.
 */
export default async function MailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const operator = await operatorOrSignIn();
  const params = await searchParams;
  const refused = typeof params['refused'] === 'string' ? `refused:${params['refused']}` : null;
  const saved = typeof params['saved'] === 'string' ? params['saved'] : null;
  const notice =
    (refused === null ? undefined : NOTICES[refused]) ??
    (saved === null ? null : (NOTICES[saved] ?? null));

  const settings = await operatorQuery((db) => getMailSettings(db));
  const store = secretStoreFromEnv();
  // Described, never fetched for display: the screen learns that a key is set and a
  // fingerprint of it, and no value reaches the page.
  const described =
    settings.credentialRef !== null && store.describe
      ? await store.describe(settings.credentialRef).catch(() => null)
      : null;

  return (
    <div className="stack">
      <SectionTabs
        tabs={INTEGRATION_TABS}
        current="/operator/verification/mail"
        label="أقسام التحقق"
      />
      <OperatorMail
        view={{
          settings,
          key:
            described === null
              ? null
              : {
                  updatedAt: described.updatedAt,
                  fingerprint: described.fields['apiKey']?.fingerprint ?? null,
                },
          secretsWritable: store.writable,
          canEdit: operatorCan(operator.role, 'integration'),
          notice,
        }}
        saveAction={saveMailAction}
        testAction={testMailAction}
      />
    </div>
  );
}
