import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';

/**
 * The developer's screen: how to call us, and what to call us with.
 *
 * A verification platform is judged before it is bought, by an engineer who has an
 * afternoon to decide whether integrating is going to hurt. So this screen answers the
 * three things that afternoon needs: where to send a request, what a working request
 * looks like in a language they use, and which inputs produce which answers.
 *
 * The test cases are published rather than described. "Send us a bad registration number
 * and see" is not a test plan; a table saying this number returns an expired registration
 * is one.
 */

export interface TestCaseView {
  input: string;
  productCode: string;
  scenario: string;
  titleAr: string;
  expectedAr: string;
}

export interface DeveloperView {
  isSandbox: boolean;
  apiBaseUrl: string;
  /** The prefix of an active key in this workspace, or null when none has been issued. */
  keyPrefix: string | null;
  testCases: TestCaseView[];
  scenarioNames: string[];
}

function curlFor(baseUrl: string, product: string, input: string, sandbox: boolean): string {
  return [
    `curl -X POST ${baseUrl}/v1/verifications \\`,
    `  -H "authorization: Bearer ${sandbox ? 'nx_test_...' : 'nx_live_...'}" \\`,
    '  -H "content-type: application/json" \\',
    `  -H "idempotency-key: $(uuidgen)" \\`,
    `  -d '{"product":"${product}","subject":{"unn":"${input}"}}'`,
  ].join('\n');
}

export function Developer({ view }: { view: DeveloperView }): ReactElement {
  const sample = view.testCases[0];

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="بيئة المطوّر"
        subtitle={
          view.isSandbox
            ? 'أنت في بيئة الاختبار. كل نداء هنا يجيبه مزوّد وهمي، ولا يمس بيانات الإنتاج ولا يُحاسَب عليه أحد.'
            : 'أنت في بيئة الإنتاج. للتجربة استخدم مفتاح بيئة الاختبار وبياناتها المنشورة أدناه.'
        }
        action={
          <a className="btn-primary" href="/settings/api-keys">
            إصدار مفتاح
          </a>
        }
      />

      <Panel title="نقطة الاتصال" aside="نفس العقد في البيئتين" role="endpoint">
        <div className="panel-body stack">
          <div>
            <span className="muted">العنوان</span>
            <div>
              <bdi dir="ltr" className="mono">
                {view.apiBaseUrl}
              </bdi>
            </div>
          </div>
          <div>
            <span className="muted">المفتاح</span>
            <div>
              <bdi dir="ltr" className="mono" data-role="key-prefix">
                {view.keyPrefix ? `${view.keyPrefix}…` : 'لم يُصدَر مفتاح بعد'}
              </bdi>
            </div>
          </div>
          {/*
            The same response shape in both worlds, and one field that differs. An
            integration that cannot tell which world answered is one that will eventually
            read a test result as a real one.
          */}
          <p className="muted" data-role="environment-note">
            كل استجابة تحمل حقل <bdi dir="ltr" className="mono">environment</bdi> بقيمة{' '}
            <bdi dir="ltr" className="mono">sandbox</bdi> أو{' '}
            <bdi dir="ltr" className="mono">live</bdi>. الشكل واحد في البيئتين، والفرق في
            هذا الحقل وفي البيانات.
          </p>
        </div>
      </Panel>

      {sample ? (
        <Panel title="نداء كامل" aside="انسخه وشغّله" role="snippet">
          <pre className="panel-body mono" data-role="curl" dir="ltr" style={{ overflowX: 'auto', margin: 0 }}>
            {curlFor(view.apiBaseUrl, sample.productCode, sample.input, view.isSandbox)}
          </pre>
        </Panel>
      ) : null}

      <Panel title="بيانات الاختبار المنشورة" aside={`${view.testCases.length} حالة`} role="test-cases">
        {view.testCases.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لا حالات منشورة.</EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>المُدخل</th>
                  <th>الوحدة</th>
                  <th>الحالة</th>
                  <th>ما الذي يُرجَع</th>
                </tr>
              </thead>
              <tbody>
                {view.testCases.map((testCase) => (
                  <tr key={`${testCase.productCode}-${testCase.input}`} data-role="test-case">
                    <td>
                      <bdi dir="ltr" className="mono">
                        {testCase.input}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {testCase.productCode}
                      </bdi>
                    </td>
                    <td>{testCase.titleAr}</td>
                    <td className="muted">{testCase.expectedAr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="فرض حالة بعينها" aside="في بيئة الاختبار وحدها" role="forced-scenario">
        <div className="panel-body stack">
          <p className="muted">
            أضف الترويسة التالية لتفرض جواباً بعينه بدل البحث عن المُدخل الذي ينتجه:
          </p>
          <pre className="mono" dir="ltr" style={{ margin: 0 }}>
            X-NX-Test-Scenario: expired_cr
          </pre>
          <p className="row" style={{ gap: 'var(--s-2)' }}>
            {view.scenarioNames.map((name) => (
              <span key={name} className="badge" data-role="scenario-name">
                <bdi dir="ltr" className="mono">
                  {name}
                </bdi>
              </span>
            ))}
          </p>
          {/* Said on the screen, because it is the reason the feature is safe. */}
          <p className="muted" data-role="live-refusal">
            مفتاح الإنتاج يتجاهل هذه الترويسة تماماً. لو احترمها لصار بإمكان المستدعي أن
            يختار نتيجته، ولفقدت كل نتيجة من المنصة معناها.
          </p>
        </div>
      </Panel>
    </div>
  );
}
