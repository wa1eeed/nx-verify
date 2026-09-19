import type { ReactElement } from 'react';
import { SubmitButton } from './ui/submit-button';
import { EmptyState, PageHeader, Panel } from './page-header';
import { IssueApiKey, type IssuedKeyState } from './issued-once';

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
  issueAction,
  revokeAction,
}: {
  keys: ApiKeyView[];
  /**
   * Issuing returns the secret to this screen and to nothing else (SEC-10): it is in no
   * address, no cookie and no log.
   */
  issueAction: (previous: IssuedKeyState, formData: FormData) => Promise<IssuedKeyState>;
  revokeAction: string | ((formData: FormData) => void | Promise<void>);
}): ReactElement {
  const active = keys.filter((key) => key.revokedAt === null);

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="مفاتيح الـAPI"
        subtitle="مفتاح لكل نظام يتصل بك. السر يظهر مرة واحدة عند الإصدار."
      />

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
                  <tr
                    key={key.id}
                    data-role="api-key"
                    data-revoked={key.revokedAt ? 'true' : 'false'}
                  >
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
                        <span className="muted">مُبطَل</span>
                      ) : (
                        /*
                          «إلغاء» read as Cancel in an Arabic interface, on a control that
                          irreversibly kills a production credential with no confirmation
                          (ADR-167). It says what it does now, and the act is two steps: the
                          consequence is spelled out before the button that does it exists.
                        */
                        <details className="revoke" data-role="revoke-key">
                          <summary>أبطِل المفتاح</summary>
                          <div className="stack" style={{ gap: 'var(--s-2)' }}>
                            <span className="faint">
                              يتوقف كل ما يستعمل هذا المفتاح فوراً، ولا يُستعاد. أصدر بديلاً
                              وبدّله أولاً إن كان في الإنتاج.
                            </span>
                            <form action={revokeAction} className="inline">
                              <input type="hidden" name="key_id" value={key.id} />
                              <SubmitButton
                                variant="ghost"
                                data-role="revoke"
                                pendingLabel="جارٍ الإبطال"
                              >
                                أبطِله نهائياً
                              </SubmitButton>
                            </form>
                          </div>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <IssueApiKey action={issueAction} />
    </div>
  );
}
