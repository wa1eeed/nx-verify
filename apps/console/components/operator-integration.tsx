import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';
import { SectionTabs } from './section-tabs';
import { isoDate } from './format';

/**
 * The connection to the data source, set from the panel.
 *
 * Everything the owner needs to control the connection without a deployment: the
 * application id and secret for each environment, the secret the data source signs its
 * notifications with, the address it sends them to, and a button that proves the
 * credential works. Nothing a subscriber can reach shows any of it, and no subscriber
 * brings a credential of their own.
 *
 * One environment is open at a time, so the screen keeps its one primary button: saving
 * the environment in front of the person. A secret is never shown back once saved. What
 * is shown is a short fingerprint, so somebody can check that what they pasted yesterday
 * is what is stored today.
 */

export type IntegrationEnvironment = 'sandbox' | 'live';

export interface StoredSecretView {
  updatedAt: Date | null;
  fields: Record<string, { fingerprint?: string; masked?: string }>;
}

export interface IntegrationView {
  environment: IntegrationEnvironment;
  baseUrl: string;
  authUrl: string;
  credential: StoredSecretView | null;
  webhook: StoredSecretView | null;
  callbackUrl: string | null;
  callbackHeader: string;
  callbackAlgorithm: 'sha256' | 'sha512';
  lastTest: { at: Date; ok: boolean; detail: string } | null;
  changes: { at: Date; operatorId: string; action: string; fields: string[] }[];
  secretsWritable: boolean;
  /** Set straight after an action, for one render. */
  notice: 'saved' | 'tested' | null;
  error: 'url' | 'readonly' | 'missing' | 'unconfigured' | null;
}

type Action = string | ((formData: FormData) => void | Promise<void>);

const ENVIRONMENT_LABELS: Record<IntegrationEnvironment, string> = {
  sandbox: 'بيئة الاختبار',
  live: 'بيئة الإنتاج',
};

const ERRORS: Record<NonNullable<IntegrationView['error']>, string> = {
  url: 'العنوان غير صالح. بيئة الإنتاج تقبل عناوين https فقط.',
  readonly:
    'هذا النشر لا يسمح بحفظ الأسرار من اللوحة. اضبط المتغير NX_SECRETS_FILE على مسار ملف في مجلد محمي ثم أعد التشغيل.',
  missing: 'أدخل معرّف التطبيق والسر. لا يوجد لهما قيمة محفوظة بعد.',
  unconfigured: 'احفظ بيانات الربط أولاً ثم اختبرها.',
};

const ACTION_LABELS: Record<string, string> = {
  'credentials.saved': 'حُفظت بيانات الربط',
  'connection.set': 'حُدّثت العناوين',
  'connection.tested': 'اختُبر الربط',
  'callback.rotated': 'أُصدر عنوان استقبال جديد',
  'callback.updated': 'حُدّث توقيع الإشعارات',
};

const FIELD_LABELS: Record<string, string> = {
  clientId: 'معرّف التطبيق',
  clientSecret: 'السر',
  webhookSecret: 'سر توقيع الإشعارات',
};

/** What a failed test means, in words a person can act on. */
function testExplanation(detail: string): string {
  if (detail === '401' || detail === '400' || detail === '403') {
    return 'رُفضت بيانات الدخول. تأكد من معرّف التطبيق والسر، وأن السر لم يُجدَّد من لوحة مصدر البيانات بعد نسخه.';
  }
  if (detail === 'timeout') {
    return 'انتهت المهلة دون رد. تأكد من عنوان إصدار الرمز ومن اتصال الخادم بالإنترنت.';
  }
  if (detail === 'unreachable') {
    return 'تعذّر الوصول إلى عنوان إصدار الرمز. تأكد من كتابته بشكل صحيح.';
  }
  if (detail === 'no stored credential') {
    return 'لا توجد بيانات ربط محفوظة لهذه البيئة.';
  }
  return `ردّ غير متوقع (${detail}).`;
}

function StoredHint({ secret, field }: { secret: StoredSecretView | null; field: string }): ReactElement {
  const entry = secret?.fields[field];
  if (!entry) {
    return <span className="faint" data-role={`hint-${field}`}>لم يُحفظ بعد</span>;
  }
  return (
    <span className="faint" data-role={`hint-${field}`}>
      {entry.masked ? (
        <>
          محفوظ:{' '}
          <bdi dir="ltr" className="mono">
            {entry.masked}
          </bdi>
        </>
      ) : (
        <>
          محفوظ · البصمة{' '}
          <bdi dir="ltr" className="mono">
            {entry.fingerprint}
          </bdi>
        </>
      )}
      {secret?.updatedAt ? (
        <>
          {' '}
          · آخر تحديث{' '}
          <bdi dir="ltr" className="mono">
            {isoDate(secret.updatedAt)}
          </bdi>
        </>
      ) : null}
    </span>
  );
}

export function OperatorIntegration({
  view,
  saveAction,
  testAction,
  callbackAction,
}: {
  view: IntegrationView;
  saveAction: Action;
  testAction: Action;
  callbackAction: Action;
}): ReactElement {
  const configured = view.credential !== null;

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="بيانات الربط"
        subtitle="مفاتيح الربط مع مصدر البيانات وسر توقيع الإشعارات، لكل بيئة على حدة. لا يراها أي مشترك."
      />

      <SectionTabs
        label="البيئة"
        current={`/operator/integration?env=${view.environment}`}
        tabs={[
          { href: '/operator/integration?env=sandbox', label: ENVIRONMENT_LABELS.sandbox },
          { href: '/operator/integration?env=live', label: ENVIRONMENT_LABELS.live },
        ]}
      />

      {view.error ? (
        <p className="sign-in-error" role="alert" data-role="integration-error">
          {ERRORS[view.error]}
        </p>
      ) : null}
      {view.notice === 'saved' ? (
        <p className="notice" role="status" data-role="integration-saved">
          حُفظت بيانات {ENVIRONMENT_LABELS[view.environment]}. اختبر الربط للتأكد منها.
        </p>
      ) : null}

      <section className="card stack" data-role="connection-status" style={{ gap: 'var(--s-2)' }}>
        <span className="stat-label">حالة الربط في {ENVIRONMENT_LABELS[view.environment]}</span>
        {!configured ? (
          <span>
            <span className="badge" data-tone="neutral">
              غير مضبوط
            </span>{' '}
            <span className="muted">أدخل معرّف التطبيق والسر أدناه ثم احفظ.</span>
          </span>
        ) : view.lastTest === null ? (
          <span>
            <span className="badge" data-tone="neutral">
              محفوظ ولم يُختبر
            </span>{' '}
            <span className="muted">اضغط «اختبر الربط» للتأكد من أن البيانات صحيحة.</span>
          </span>
        ) : view.lastTest.ok ? (
          <span>
            <span className="badge" data-tone="fresh" data-role="test-ok">
              يعمل
            </span>{' '}
            <span className="muted">
              آخر اختبار ناجح{' '}
              <bdi dir="ltr" className="mono">
                {view.lastTest.at.toISOString().slice(0, 16).replace('T', ' ')}
              </bdi>
            </span>
          </span>
        ) : (
          <span className="stack" style={{ gap: 'var(--s-1)' }}>
            <span>
              <span className="badge" data-tone="critical" data-role="test-failed">
                فشل آخر اختبار
              </span>{' '}
              <bdi dir="ltr" className="mono muted">
                {view.lastTest.at.toISOString().slice(0, 16).replace('T', ' ')}
              </bdi>
            </span>
            <span>{testExplanation(view.lastTest.detail)}</span>
          </span>
        )}
      </section>

      <Panel
        title="مفاتيح الربط"
        aside={ENVIRONMENT_LABELS[view.environment]}
        note="اترك أي حقل سري فارغاً لإبقاء قيمته المحفوظة. القيم تُحفظ مشفّرة في مخزن الأسرار، ولا تُكتب في قاعدة البيانات ولا تُعرض بعد حفظها."
        role="credentials"
      >
        <form action={saveAction} className="panel-body stack" data-role="credentials-form">
          <input type="hidden" name="environment" value={view.environment} />

          <label htmlFor="client_id">معرّف التطبيق (Application ID)</label>
          <input id="client_id" name="client_id" dir="ltr" className="mono" autoComplete="off" />
          <StoredHint secret={view.credential} field="clientId" />

          <label htmlFor="client_secret">السر (Client Secret)</label>
          <input
            id="client_secret"
            name="client_secret"
            type="password"
            dir="ltr"
            className="mono"
            autoComplete="new-password"
          />
          <StoredHint secret={view.credential} field="clientSecret" />

          <label htmlFor="webhook_secret">سر توقيع الإشعارات (Webhook Secret)</label>
          <input
            id="webhook_secret"
            name="webhook_secret"
            type="password"
            dir="ltr"
            className="mono"
            autoComplete="new-password"
          />
          <StoredHint secret={view.webhook} field="webhookSecret" />

          <details data-role="addresses">
            <summary className="muted">العناوين</summary>
            <div className="stack" style={{ marginBlockStart: 'var(--s-3)' }}>
              <label htmlFor="base_url">عنوان الـAPI</label>
              <input id="base_url" name="base_url" defaultValue={view.baseUrl} dir="ltr" className="mono" required />
              <label htmlFor="auth_url">عنوان إصدار الرمز</label>
              <input id="auth_url" name="auth_url" defaultValue={view.authUrl} dir="ltr" className="mono" required />
            </div>
          </details>

          <div className="row">
            <button type="submit" className="btn-primary" data-role="save-credentials" disabled={!view.secretsWritable}>
              حفظ
            </button>
          </div>
        </form>
      </Panel>

      <Panel title="اختبار الربط" aside="لا يستهلك أي عملية تحقق" role="test">
        <form action={testAction} className="panel-body row" style={{ justifyContent: 'space-between' }}>
          <input type="hidden" name="environment" value={view.environment} />
          <span className="muted">يطلب رمز دخول بالبيانات المحفوظة، ولا يرسل أي بيانات عملاء.</span>
          <button type="submit" className="btn-secondary" data-role="test-connection" disabled={!configured}>
            اختبر الربط
          </button>
        </form>
      </Panel>

      <Panel
        title="عنوان استقبال الإشعارات"
        note="انسخ هذا العنوان إلى إعدادات الإشعارات (Webhooks) في لوحة مصدر البيانات لهذه البيئة، مع سر التوقيع نفسه المحفوظ أعلاه."
        role="callback"
      >
        <div className="panel-body stack">
          {view.callbackUrl ? (
            <code className="mono copyable" dir="ltr" data-role="callback-url">
              {view.callbackUrl}
            </code>
          ) : (
            <span className="muted" data-role="callback-url">
              يُصدر العنوان تلقائياً عند أول حفظ لبيانات الربط.
            </span>
          )}
          {view.callbackUrl ? (
            <details>
              <summary className="muted">التوقيع وتجديد العنوان</summary>
              <form action={callbackAction} className="stack" style={{ marginBlockStart: 'var(--s-3)' }}>
                <input type="hidden" name="environment" value={view.environment} />
                <label htmlFor="callback_header">ترويسة التوقيع</label>
                <input id="callback_header" name="callback_header" defaultValue={view.callbackHeader} dir="ltr" className="mono" />
                <label htmlFor="callback_algorithm">الخوارزمية</label>
                <select id="callback_algorithm" name="callback_algorithm" defaultValue={view.callbackAlgorithm}>
                  <option value="sha256">HMAC-SHA256</option>
                  <option value="sha512">HMAC-SHA512</option>
                </select>
                <label className="row" style={{ gap: 'var(--s-2)' }}>
                  <input type="checkbox" name="rotate" value="1" style={{ width: 'auto' }} />
                  إصدار عنوان جديد. العنوان الحالي يتوقف فوراً، فحدّثه في لوحة مصدر البيانات مباشرة.
                </label>
                <div className="row">
                  <button type="submit" className="btn-secondary" data-role="save-callback">
                    تحديث
                  </button>
                </div>
              </form>
            </details>
          ) : null}
        </div>
      </Panel>

      <Panel title="سجل التغييرات" aside={ENVIRONMENT_LABELS[view.environment]} role="changes">
        {view.changes.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لا تغييرات مسجّلة على هذه البيئة بعد.</EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>ما حدث</th>
                  <th>بواسطة</th>
                </tr>
              </thead>
              <tbody>
                {view.changes.map((change, index) => (
                  <tr key={`${change.at.toISOString()}-${index}`}>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {change.at.toISOString().slice(0, 16).replace('T', ' ')}
                      </bdi>
                    </td>
                    <td>
                      {ACTION_LABELS[change.action] ?? change.action}
                      {change.fields.length > 0 ? (
                        <span className="muted"> · {change.fields.map((field) => FIELD_LABELS[field] ?? field).join('، ')}</span>
                      ) : null}
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono muted">
                        {change.operatorId}
                      </bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
