import Link from 'next/link';
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

export interface PlaygroundResult {
  reference: string | null;
  status: string;
  decision: string | null;
  /** The response envelope, shaped exactly as the API returns it. */
  response: unknown;
  latencyMs: number | null;
}

export interface DeveloperView {
  isSandbox: boolean;
  apiBaseUrl: string;
  /** The prefix of an active key in this workspace, or null when none has been issued. */
  keyPrefix: string | null;
  testCases: TestCaseView[];
  scenarioNames: string[];
  products: { code: string; nameAr: string }[];
  /** The run the address named, when the playground has just been used. */
  lastRun?: PlaygroundResult | null;
  /** Set when the last attempt was refused, and why. */
  error?: 'live' | 'input' | null;
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

export function Developer({
  view,
  runAction,
}: {
  view: DeveloperView;
  runAction?: string | ((formData: FormData) => void | Promise<void>);
}): ReactElement {
  const sample = view.testCases[0];

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="بيئة الاختبار"
        subtitle={
          view.isSandbox
            ? 'أنت في بيئة الاختبار. النداءات هنا تجيبها بيانات وهمية، ولا تُحاسَب عليها.'
            : 'أنت في بيئة الإنتاج. بيئة الاختبار مساحة عمل منفصلة، ولها مفاتيحها ورصيدها.'
        }
        action={
          view.isSandbox ? (
            <Link className="btn btn-primary" href="/settings/developers">
              إصدار مفتاح
            </Link>
          ) : null
          /*
           * Nothing, on a live workspace.
           *
           * «إصدار مفتاح» is not it: that issues a live key from a screen headed «بيئة
           * الاختبار». And the header used to carry «اطلب مساحة اختبار» pointing at the
           * support page, which registers nothing, while the card above this screen registers
           * the ask for real (ADR-173). Two buttons for one act, one of which works, is worse
           * than one button: the reader presses the larger one and it does nothing.
           */
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
          {/*
            Only in the sandbox. On a live workspace this printed the prefix of the first
            LIVE key, on a screen headed «بيئة الاختبار», next to a sentence telling the
            reader to use the test key below. There is no test key below: keys follow the
            workspace, and a live workspace can only ever issue live ones (ADR-166).
          */}
          {view.isSandbox ? (
            <div>
              <span className="muted">المفتاح</span>
              <div>
                <bdi dir="ltr" className="mono" data-role="key-prefix">
                  {view.keyPrefix ? `${view.keyPrefix}…` : 'لم يُصدَر مفتاح بعد'}
                </bdi>
              </div>
            </div>
          ) : null}
          {/*
            The same response shape in both worlds, and one field that differs. An
            integration that cannot tell which world answered is one that will eventually
            read a test result as a real one.
          */}
          <p className="muted" data-role="environment-note">
            كل استجابة تحمل حقل{' '}
            <bdi dir="ltr" className="mono">
              environment
            </bdi>{' '}
            بقيمة{' '}
            <bdi dir="ltr" className="mono">
              sandbox
            </bdi>{' '}
            أو{' '}
            <bdi dir="ltr" className="mono">
              live
            </bdi>
            . الشكل واحد في البيئتين، والفرق في هذا الحقل وفي البيانات.
          </p>
        </div>
      </Panel>

      {sample ? (
        <Panel title="نداء كامل" aside="انسخه وشغّله" role="snippet">
          <pre
            className="panel-body mono"
            data-role="curl"
            dir="ltr"
            style={{ overflowX: 'auto', margin: 0 }}
          >
            {curlFor(view.apiBaseUrl, sample.productCode, sample.input, view.isSandbox)}
          </pre>
        </Panel>
      ) : null}

      {runAction && !view.isSandbox ? (
        <Panel title="جرّب الآن" aside="في بيئة الاختبار وحدها" role="playground">
          <div className="panel-body stack">
            {/*
              Not a form. On a live workspace its only possible outcome was a refusal, so it
              read as a broken button rather than as a thing that belongs elsewhere.

              And «elsewhere» is named as it is: the card at the top of this screen, not the
              support page. What follows the ask is what the card and the panel actually do
              (ADR-173), so the sentence ends where the code ends: a separate workspace with
              its own keys and its own test credit, entered by whoever asked for it, with a
              first password they are made to change. It used to say «وتدخلها بنفس بريدك»,
              which reads as the same sign in, and the reader would have tried theirs.
            */}
            <p className="muted" data-role="playground-elsewhere">
              التشغيل من هذه الصفحة متاح في بيئة الاختبار وحدها. زر يستطيع إنفاق مال العميل بنقرة
              فضول ليس ميزة. مساحة الاختبار تُطلب من بطاقة «مساحة الاختبار» في هذه الصفحة، وتُنشأ من
              لوحة المنصة بمفاتيحها ورصيدها التجريبي. يدخلها من طلبها ببريده نفسه، بكلمة مرور أولى
              يُطلب تغييرها عند أول دخول، ومن عداه يحتاج حساباً فيها.
            </p>
          </div>
        </Panel>
      ) : null}

      {runAction && view.isSandbox ? (
        <Panel title="جرّب الآن" aside="في بيئة الاختبار وحدها" role="playground">
          <div className="panel-body stack">
            {view.error === 'input' ? (
              <p className="sign-in-error" data-role="playground-refusal" role="alert">
                اختر وحدة واكتب مُدخلاً قبل التشغيل.
              </p>
            ) : null}

            <form action={runAction} className="row" style={{ gap: 'var(--s-3)' }}>
              <select name="product" aria-label="الوحدة" style={{ width: 'auto' }}>
                {view.products.map((product) => (
                  <option key={product.code} value={product.code}>
                    {product.nameAr}
                  </option>
                ))}
              </select>
              <input
                name="input"
                placeholder="7001272184"
                dir="ltr"
                className="mono"
                style={{ width: 'auto' }}
                aria-label="المُدخل"
                required
              />
              <select name="scenario" aria-label="حالة مفروضة" style={{ width: 'auto' }}>
                <option value="">بلا فرض</option>
                {view.scenarioNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn btn-secondary" data-role="run-playground">
                شغّل
              </button>
            </form>

            {view.lastRun ? (
              <div className="stack" data-role="playground-result">
                <div className="row">
                  <span className="badge" data-role="playground-status">
                    {view.lastRun.status}
                  </span>
                  {view.lastRun.reference ? (
                    <bdi dir="ltr" className="mono">
                      {view.lastRun.reference}
                    </bdi>
                  ) : null}
                </div>
                {/* The envelope the integration will receive, not an illustration of it. */}
                <pre className="mono" dir="ltr" style={{ overflowX: 'auto', margin: 0 }}>
                  {JSON.stringify(view.lastRun.response, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

      <Panel
        title="بيانات الاختبار المنشورة"
        aside={`${view.testCases.length} حالة`}
        role="test-cases"
      >
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
            مفتاح الإنتاج يتجاهل هذه الترويسة تماماً. لو احترمها لصار بإمكان المستدعي أن يختار
            نتيجته، ولفقدت كل نتيجة من المنصة معناها.
          </p>
        </div>
      </Panel>
    </div>
  );
}
