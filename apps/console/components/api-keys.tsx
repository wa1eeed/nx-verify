import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';

/**
 * The keys a workspace uses to call the API.
 *
 * The secret is never here. It exists once, in the response that created it, and this
 * screen shows the prefix, which is what a customer matches against their own
 * configuration and what a support conversation can safely quote.
 *
 * Environment is shown on every row rather than filtered away, because the mistake this
 * screen exists to prevent is a test key in production, and a list that hides the
 * distinction is how that mistake is made.
 */

export interface ApiKeyView {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  environment: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

const ENVIRONMENT_LABELS: Record<string, string> = {
  live: 'الإنتاج',
  sandbox: 'الاختبار',
};

export function ApiKeys({
  keys,
  issuedSecret,
  issueAction,
  revokeAction,
}: {
  keys: ApiKeyView[];
  /** Shown once, immediately after issuing, and never again. */
  issuedSecret?: string | null;
  issueAction: string | ((formData: FormData) => void | Promise<void>);
  revokeAction: string | ((formData: FormData) => void | Promise<void>);
}): ReactElement {
  const active = keys.filter((key) => key.revokedAt === null);

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="مفاتيح الـAPI"
        subtitle="مفتاح واحد لكل نظام يتصل بنا. السر يظهر مرة واحدة عند الإصدار ولا يمكن استرجاعه."
      />

      {issuedSecret ? (
        <section className="card stack" data-role="issued-secret">
          <strong>المفتاح الجديد</strong>
          <bdi dir="ltr" className="mono" data-role="secret-value">
            {issuedSecret}
          </bdi>
          <p className="muted">
            انسخه الآن. لا نخزّنه، ولا يمكن عرضه مرة أخرى. فقده يعني إصدار مفتاح بديل، وهذا
            هو الجواب الصحيح لا نقصاً في المنصة.
          </p>
        </section>
      ) : null}

      <Panel title="المفاتيح" aside={`${active.length} مفعّل`}>
        {keys.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لا مفاتيح بعد. أصدر واحداً لتبدأ التكامل.</EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>البادئة</th>
                  <th>البيئة</th>
                  <th>الصلاحيات</th>
                  <th>آخر استخدام</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id} data-role="api-key" data-revoked={key.revokedAt ? 'true' : 'false'}>
                    <td>{key.name}</td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {key.keyPrefix}…
                      </bdi>
                    </td>
                    <td>
                      <span
                        className="badge"
                        data-role="environment"
                        style={
                          key.environment === 'live'
                            ? { borderColor: 'var(--fresh-line)', color: 'var(--fresh-fg)' }
                            : { borderColor: 'var(--line-strong)', color: 'var(--ink-soft)' }
                        }
                      >
                        {ENVIRONMENT_LABELS[key.environment] ?? key.environment}
                      </span>
                    </td>
                    <td className="muted">{key.scopes.join('، ')}</td>
                    <td>
                      {key.lastUsedAt ? (
                        <bdi dir="ltr" className="mono">
                          {key.lastUsedAt.toISOString().slice(0, 10)}
                        </bdi>
                      ) : (
                        <span className="muted">لم يُستخدم</span>
                      )}
                    </td>
                    <td>
                      {key.revokedAt ? (
                        <span className="muted">ملغى</span>
                      ) : (
                        <form action={revokeAction} method="post" className="inline">
                          <input type="hidden" name="key_id" value={key.id} />
                          <button type="submit" className="link" data-role="revoke">
                            إلغاء
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="إصدار مفتاح">
        <form action={issueAction} method="post" className="panel-body stack">
          <label htmlFor="key-name">الاسم</label>
          <input id="key-name" name="name" required placeholder="نظام الفوترة" />
          <p className="muted">
            الصلاحيات تُمنح كما هي لباقي مفاتيح مساحة العمل. البيئة تتبع مساحة العمل التي
            أنت فيها، فلا يمكن إصدار مفتاح إنتاج من بيئة الاختبار.
          </p>
          <button type="submit" className="btn-primary" data-role="issue-key">
            إصدار
          </button>
        </form>
      </Panel>
    </div>
  );
}
