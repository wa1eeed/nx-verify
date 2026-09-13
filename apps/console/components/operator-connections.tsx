import type { ReactElement } from 'react';
import { PageHeader, Panel } from './page-header';

/**
 * Where a provider's address and credential are set, for both worlds.
 *
 * Two rows per provider, because a sandbox host and a production host are different
 * addresses with different credentials, and a platform that cannot tell them apart will
 * one day check a real company against a test service.
 *
 * The credential is written through to the secret store and never into our tables (rule
 * 10). Where the deployment reads secrets from its environment, which a panel cannot
 * write, the screen says so and prints the exact line to set instead of pretending to
 * save. Half working is worse than refusing.
 */

export interface ConnectionView {
  provider: string;
  environment: 'sandbox' | 'live';
  kind: string;
  baseUrl: string | null;
  authUrl: string | null;
  credentialRef: string | null;
  timeoutMs: number;
  status: string;
  hasSecret: boolean;
  /** The full address a provider posts to, once one has been issued. */
  callbackUrl: string | null;
  callbackHeader: string;
  callbackAlgorithm: string;
  updatedAt: Date | null;
}

export interface ConnectionsView {
  providers: string[];
  connections: ConnectionView[];
  /** True when the deployment's secret store can be written to from here. */
  secretsWritable: boolean;
  /** The variable the deployment reads secrets from, when it reads them from one. */
  secretsVariable: string | null;
}

const ENVIRONMENTS: ('sandbox' | 'live')[] = ['sandbox', 'live'];

const ENVIRONMENT_LABELS: Record<string, string> = {
  sandbox: 'بيئة الاختبار',
  live: 'بيئة الإنتاج',
};

const KIND_HELP: Record<string, string> = {
  stub: 'مزوّد وهمي داخلي. لا عنوان له ولا اعتماد، ويجيب ببيانات الاختبار المنشورة.',
  http: 'مزوّد سجلّي عبر HTTP. يحتاج عنوان الـAPI واعتماداً بمفتاح ثابت.',
  openbanking: 'مزوّد خدمات مصرفية مفتوحة. يحتاج عنوانين: عنوان الـAPI وعنوان إصدار الرمز، واعتماداً بمعرّف عميل وسر.',
};

export function OperatorConnections({
  view,
  setConnectionAction,
  setSecretAction,
  setCallbackAction,
}: {
  view: ConnectionsView;
  setConnectionAction: string | ((formData: FormData) => void | Promise<void>);
  setSecretAction: string | ((formData: FormData) => void | Promise<void>);
  setCallbackAction: string | ((formData: FormData) => void | Promise<void>);
}): ReactElement {
  const find = (provider: string, environment: string): ConnectionView | undefined =>
    view.connections.find(
      (connection) => connection.provider === provider && connection.environment === environment,
    );

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="ربط المزودين"
        subtitle="عنوان كل مزوّد واعتماده، لكل بيئة على حدة."
      />

      <Panel title="كيف يُركَّب مزوّد" role="instructions">
        <ol className="panel-body stack" style={{ gap: 'var(--s-2)', margin: 0 }}>
          <li>
            اختر البيئة. <strong>ابدأ ببيئة الاختبار دائماً</strong>: مفاتيح العملاء التي
            تبدأ بـ<bdi dir="ltr" className="mono">nx_test_</bdi> تصل إليها وحدها، ومفاتيح{' '}
            <bdi dir="ltr" className="mono">nx_live_</bdi> تصل إلى الإنتاج وحده.
          </li>
          <li>
            اختر النوع واكتب العنوان. المزوّد السجلّي يحتاج عنواناً واحداً، ومزوّد الخدمات
            المصرفية المفتوحة يحتاج عنوان الـAPI وعنوان إصدار الرمز.
          </li>
          <li>
            اكتب مرجع الاعتماد بالشكل{' '}
            <bdi dir="ltr" className="mono">kms://providers/&lt;provider&gt;/&lt;env&gt;</bdi>.
            هذا <strong>مؤشر</strong>: المنصة لا تخزّن السر في قاعدتها ولا في نسخها
            الاحتياطية.
          </li>
          <li>
            احفظ السر في الحقل المخصّص. يُكتب في مخزن الأسرار مباشرة، ولا يمر على أي جدول
            عندنا، ولا يُعرض بعد حفظه.
          </li>
          <li>
            اربط المشترك بالمزوّد من <a href="/operator/providers">شاشة التوجيه</a>، ثم
            تحقّق من <a href="/operator/health">صحة الخدمة</a>. والحوالات بانتظار التأكيد في{' '}
            <a href="/operator/topups">شاشة الحوالات</a>. وما ينقص هذا النشر كاملاً في{' '}
            <a href="/operator/readiness">جاهزية النشر</a>. وأين يذهب كل نداء في{' '}
            <a href="/operator/endpoints">خريطة نقاط النهاية</a>.
          </li>
        </ol>
      </Panel>

      {!view.secretsWritable ? (
        <p className="sign-in-error" data-role="secrets-readonly" role="alert">
          هذا النشر يقرأ الأسرار من متغيّر البيئة{' '}
          <bdi dir="ltr" className="mono">{view.secretsVariable ?? 'NX_SECRETS'}</bdi>، ولا
          تستطيع لوحة أن تكتب فيه. اضبط السر هناك، أو اربط مدير أسرار عبر{' '}
          <bdi dir="ltr" className="mono">NX_SECRETS_ENDPOINT</bdi> ليصير الحفظ من هنا
          ممكناً. لن نتظاهر بالحفظ.
        </p>
      ) : null}

      {view.providers.map((provider) => (
        <Panel key={provider} title={provider} aside="بيئتان مستقلتان" role="provider-connection">
          <div className="panel-body stack" style={{ gap: 'var(--s-5)' }}>
            {ENVIRONMENTS.map((environment) => {
              const connection = find(provider, environment);
              return (
                <div key={environment} className="stack" data-role="environment-block" data-environment={environment}>
                  <strong>{ENVIRONMENT_LABELS[environment]}</strong>

                  <form action={setConnectionAction} method="post" className="row" style={{ gap: 'var(--s-3)' }}>
                    <input type="hidden" name="provider" value={provider} />
                    <input type="hidden" name="environment" value={environment} />
                    <select name="kind" defaultValue={connection?.kind ?? 'http'} aria-label="النوع" style={{ width: 'auto' }}>
                      <option value="stub">وهمي</option>
                      <option value="http">سجلّي (HTTP)</option>
                      <option value="openbanking">خدمات مصرفية مفتوحة</option>
                    </select>
                    <input
                      name="base_url"
                      defaultValue={connection?.baseUrl ?? ''}
                      placeholder="https://sandbox.example.com"
                      dir="ltr"
                      className="mono"
                      aria-label="عنوان الـAPI"
                      style={{ width: 'auto' }}
                    />
                    <input
                      name="auth_url"
                      defaultValue={connection?.authUrl ?? ''}
                      placeholder="https://auth.example.com/oauth2/token"
                      dir="ltr"
                      className="mono"
                      aria-label="عنوان إصدار الرمز"
                      style={{ width: 'auto' }}
                    />
                    <input
                      name="credential_ref"
                      defaultValue={connection?.credentialRef ?? `kms://providers/${provider}/${environment}`}
                      dir="ltr"
                      className="mono"
                      aria-label="مرجع الاعتماد"
                      style={{ width: 'auto' }}
                      data-role="credential-ref"
                    />
                    <button type="submit" className="btn-secondary" data-role="save-connection">
                      حفظ الاتصال
                    </button>
                  </form>

                  <form action={setSecretAction} method="post" className="row" style={{ gap: 'var(--s-3)' }}>
                    <input type="hidden" name="provider" value={provider} />
                    <input type="hidden" name="environment" value={environment} />
                    <input
                      name="client_id"
                      placeholder="معرّف العميل أو اسم المفتاح"
                      dir="ltr"
                      className="mono"
                      aria-label="معرّف العميل"
                      style={{ width: 'auto' }}
                    />
                    <input
                      name="secret"
                      type="password"
                      placeholder="السر"
                      dir="ltr"
                      aria-label="السر"
                      style={{ width: 'auto' }}
                      data-role="secret-input"
                    />
                    <button
                      type="submit"
                      className="btn-secondary"
                      data-role="save-secret"
                      disabled={!view.secretsWritable}
                    >
                      حفظ السر في المخزن
                    </button>
                    {/*
                      What we hold is the pointer, never the material, so the label says
                      that and nothing more. Claiming a secret is saved would be a claim
                      about a store we did not read, and an operator who trusts it would
                      stop looking for the reason a call is failing.
                    */}
                    <span className="muted" data-role="secret-state">
                      {connection?.hasSecret ? 'مرجع الاعتماد مضبوط' : 'بلا مرجع اعتماد'}
                    </span>
                  </form>

                  {/*
                    Some answers do not come back on the call that asked for them. This is
                    the address the provider posts to when it has finished, and it carries
                    no provider name because a URL is a public surface (rule 5).
                  */}
                  <form action={setCallbackAction} method="post" className="row" style={{ gap: 'var(--s-3)' }}>
                    <input type="hidden" name="provider" value={provider} />
                    <input type="hidden" name="environment" value={environment} />
                    <input
                      name="callback_header"
                      defaultValue={connection?.callbackHeader ?? 'x-nx-provider-signature'}
                      dir="ltr"
                      className="mono"
                      aria-label="ترويسة التوقيع"
                      style={{ width: 'auto' }}
                    />
                    <select
                      name="callback_algorithm"
                      defaultValue={connection?.callbackAlgorithm ?? 'sha256'}
                      aria-label="خوارزمية التوقيع"
                      style={{ width: 'auto' }}
                    >
                      <option value="sha256">HMAC-SHA256</option>
                      <option value="sha512">HMAC-SHA512</option>
                    </select>
                    <button type="submit" className="btn-secondary" data-role="issue-callback">
                      {connection?.callbackUrl ? 'تدوير العنوان' : 'إصدار عنوان الاستقبال'}
                    </button>
                    {connection?.callbackUrl ? (
                      <span className="mono" dir="ltr" data-role="callback-url">
                        {connection.callbackUrl}
                      </span>
                    ) : (
                      <span className="muted" data-role="callback-url">
                        بلا عنوان استقبال
                      </span>
                    )}
                  </form>

                  <p className="faint">{KIND_HELP[connection?.kind ?? 'http']}</p>
                </div>
              );
            })}
          </div>
        </Panel>
      ))}
    </div>
  );
}
