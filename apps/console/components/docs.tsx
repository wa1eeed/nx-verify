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
}

export interface DocsView {
  apiBaseUrl: string;
  products: DocProductView[];
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

export function Docs({ view }: { view: DocsView }): ReactElement {
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="المرجع"
        subtitle="مولّد من كتالوج المنتجات نفسه، فما تقرأه هنا هو ما تتحقق منه المنصة فعلاً."
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
              NX-4021
            </bdi>
            ، ورسالتين عربية وإنجليزية، وعَلَم{' '}
            <bdi dir="ltr" className="mono">
              retryable
            </bdi>
            ، و<bdi dir="ltr" className="mono">request_id</bdi>. أرسل هذا الأخير مع أي سؤال
            للدعم: به نجد النداء في ثوانٍ.
          </p>
          <p className="muted" data-role="authority-note">
            كل حقل في الاستجابة يحمل الجهة الرسمية التي أصدرته ووقت رصده. ولا تحمل
            الاستجابة اسم أي مزوّد: الجهة هي ما يعنيك، والطريق إليها شأننا.
          </p>
        </div>
      </Panel>

      {view.products.map((product) => (
        <Panel
          key={product.code}
          title={product.nameAr}
          aside={product.allowed ? product.code : `${product.code} · غير مشمولة في باقتك`}
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
              <pre className="mono" dir="ltr" style={{ margin: 0, overflowX: 'auto' }} data-role="schema">
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
    </div>
  );
}
