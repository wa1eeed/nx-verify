import type { ReactElement } from 'react';
import { PageHeader, Panel } from './page-header';

/**
 * The reference, generated from the catalogue rather than written beside it.
 *
 * Products are rows (rule 8), so a new verification module appears in the customer's
 * documentation the moment it is enabled, with the input it actually validates against.
 * Documentation written by hand beside a catalogue that changes is documentation that
 * lies, and the customer finds out by getting a 422 that the page said was impossible.
 *
 * The parts that are not generated are the parts that do not change per product: the
 * envelope, idempotency, the error shape, and what to send support.
 */

export interface DocProductView {
  code: string;
  nameAr: string;
  subjectType: string;
  /** The JSON Schema the platform validates against, exactly as stored. */
  inputSchema: unknown;
  allowed: boolean;
  refusalAr: string | null;
  /**
   * What one successful run costs, or null when a plan or a bundle covers it (ADR-169).
   *
   * The screen's own subtitle promised «مدخلاتها، ومخرجاتها، وسعر كل واحدة» and showed the
   * inputs alone. A developer deciding which check to call is deciding on what it costs.
   */
  priceHalalas: number | null;
  coveredByPlan: boolean;
}

export interface ErrorRow {
  code: string;
  status: number;
  retryable: boolean;
  messageAr: string;
}

export interface DocsView {
  apiBaseUrl: string;
  products: DocProductView[];
  /**
   * Every code the API can return.
   *
   * The screen cited NX-4031 as an example and carried no table, and the call log printed
   * codes raw with nothing to look them up in. A developer met a code and had to ask us.
   */
  errors: readonly ErrorRow[];
}

function requiredFields(schema: unknown): string[] {
  const object = schema as { required?: unknown; oneOf?: { required?: string[] }[] };
  if (Array.isArray(object.required)) {
    return object.required as string[];
  }
  if (Array.isArray(object.oneOf)) {
    // A product that accepts either of two identifiers says so rather than listing both
    // as required, because listing both would be false.
    return object.oneOf.flatMap((branch) => branch.required ?? []);
  }
  return [];
}

/** What one run costs, in the words the reader needs: a price, «من باقتك», or «بلا سعر». */
function priceLabelAr(product: DocProductView): string {
  if (product.coveredByPlan) {
    return 'من باقتك';
  }
  return product.priceHalalas === null
    ? 'لا سعر معروض'
    : `${(product.priceHalalas / 100).toFixed(2)} ر.س للعملية`;
}

export function Docs({ view }: { view: DocsView }): ReactElement {
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="مرجع الـAPI"
        subtitle="وحدات التحقق: مدخلاتها، ومخرجاتها، وسعر كل واحدة."
      />

      <Panel title="الأساسيات" role="basics">
        <div className="panel-body stack">
          <p>
            كل نداء يحمل ترويسة{' '}
            <bdi dir="ltr" className="mono">
              authorization: Bearer &lt;key&gt;
            </bdi>{' '}
            وترويسة{' '}
            <bdi dir="ltr" className="mono">
              idempotency-key
            </bdi>
            . المفتاح نفسه مع نفس الجسم يُرجع نفس النتيجة ورسماً واحداً.
          </p>
          <p>
            كل خطأ يحمل رمزاً خاصاً بنا مثل{' '}
            <bdi dir="ltr" className="mono">
              NX-4031
            </bdi>
            ، ورسالتين عربية وإنجليزية، وعَلَم{' '}
            <bdi dir="ltr" className="mono">
              retryable
            </bdi>
            ، و
            <bdi dir="ltr" className="mono">
              request_id
            </bdi>
            . أرسل هذا الأخير مع أي سؤال للدعم: به نجد النداء في ثوانٍ.
          </p>
          <p className="muted" data-role="authority-note">
            كل حقل في الاستجابة يحمل الجهة الرسمية التي أصدرته ووقت رصده. ولا تحمل الاستجابة اسم أي
            مزوّد: الجهة هي ما يعنيك، والطريق إليها شأننا.
          </p>
        </div>
      </Panel>

      {view.products.map((product) => (
        <Panel
          key={product.code}
          title={product.nameAr}
          aside={
            product.allowed
              ? `${product.code} · ${priceLabelAr(product)}`
              : `${product.code} · غير مشمولة في باقتك`
          }
          role="doc-product"
        >
          <div className="panel-body stack">
            <div>
              <span className="muted">النداء</span>
              <pre className="mono" dir="ltr" style={{ margin: 0, overflowX: 'auto' }}>
                {`POST ${view.apiBaseUrl}/v1/verifications
{"product":"${product.code}","subject":{ ... }}`}
              </pre>
            </div>

            <div>
              <span className="muted">
                الحقول المطلوبة: {requiredFields(product.inputSchema).join('، ') || 'لا شيء'}
              </span>
              <pre
                className="mono"
                dir="ltr"
                style={{ margin: 0, overflowX: 'auto' }}
                data-role="schema"
              >
                {JSON.stringify(product.inputSchema, null, 2)}
              </pre>
            </div>

            {!product.allowed && product.refusalAr ? (
              <p className="muted" data-role="doc-refusal">
                {product.refusalAr}
              </p>
            ) : null}
          </div>
        </Panel>
      ))}

      {/*
        The codes, in a table. The screen cited one as an example and had none, and the call
        log printed them raw with nothing to look them up in (ADR-169).
      */}
      <Panel title="رموز الأخطاء" aside={`${view.errors.length}`} role="error-codes">
        <div className="table-scroll">
          <table data-role="error-table">
            <thead>
              <tr>
                <th>الرمز</th>
                <th>HTTP</th>
                <th>المعنى</th>
                <th>يُعاد؟</th>
              </tr>
            </thead>
            <tbody>
              {view.errors.map((row) => (
                <tr key={row.code} data-role="error-row" data-code={row.code}>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {row.code}
                    </bdi>
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {row.status}
                    </bdi>
                  </td>
                  <td>{row.messageAr}</td>
                  <td>
                    {/* The one field a client acts on: retry, or stop and fix the call. */}
                    {row.retryable ? 'نعم، أعد المحاولة' : 'لا، صحّح النداء'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
