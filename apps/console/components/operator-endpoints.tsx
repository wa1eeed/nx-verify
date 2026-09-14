import type { ReactElement } from 'react';

/**
 * A provider's endpoint map, edited here.
 *
 * What a row describes is somebody else's API: where a call goes, where the useful part
 * of their envelope sits, and what they call the fields we already have names for. None
 * of that belongs in a release, because it changes on their timetable.
 *
 * What is not editable here is our side. The endpoint column is the name a product step
 * uses, and the field map's right hand side is our field name: changing those would move
 * the product rather than the provider, and that is a seed and a review.
 */

export interface EndpointRowView {
  provider: string;
  environment: 'sandbox' | 'live';
  endpoint: string;
  method: string;
  path: string;
  authority: string;
  dataPath: string | null;
  fieldMap: Record<string, string>;
  bodyMap: Record<string, string> | null;
}

export interface EndpointsView {
  providers: string[];
  /** The endpoint names product steps actually ask for, so nothing is invented here. */
  required: string[];
  rows: EndpointRowView[];
}

const ENVIRONMENTS: ('sandbox' | 'live')[] = ['sandbox', 'live'];
const ENVIRONMENT_LABELS: Record<string, string> = {
  sandbox: 'بيئة الاختبار',
  live: 'بيئة الإنتاج',
};

export function OperatorEndpoints({
  view,
  setEndpointAction,
}: {
  view: EndpointsView;
  setEndpointAction: string | ((formData: FormData) => void | Promise<void>);
}): ReactElement {
  const rowFor = (provider: string, environment: string, endpoint: string) =>
    view.rows.find(
      (row) =>
        row.provider === provider && row.environment === environment && row.endpoint === endpoint,
    ) ?? null;

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <section className="panel" data-role="endpoint-help">
        <div className="panel-header">
          <h2>كيف تُدخَل خريطة مزوّد</h2>
        </div>
        <ol className="panel-body stack" style={{ gap: 'var(--s-2)', margin: 0 }}>
          <li>
            <strong>المسار</strong> كما في توثيق المزوّد، وما بين قوسين معقوفين يُملأ من مدخلات
            الخطوة:{' '}
            <bdi dir="ltr" className="mono">
              {'/v1/address/{identifications}'}
            </bdi>
          </li>
          <li>
            <strong>مسار البيانات</strong> هو اسم الحقل الذي يحوي الإجابة داخل مظروفهم، مثل{' '}
            <bdi dir="ltr" className="mono">
              data
            </bdi>
            . اتركه فارغاً إن كانت الإجابة في الجذر.
          </li>
          <li>
            <strong>خريطة الحقول</strong> من أسمائهم إلى أسمائنا، سطراً لكل حقل بالشكل{' '}
            <bdi dir="ltr" className="mono">
              cityName=city
            </bdi>
            . اليمين اسمنا ولا يتغيّر.
          </li>
          <li>
            <strong>جسم الطلب</strong> لنداءات POST وحدها، بنفس الشكل، والقيمة التي تبدأ بـ
            <bdi dir="ltr" className="mono">
              $.
            </bdi>{' '}
            تُقرأ من مدخلات الخطوة.
          </li>
          <li>ابدأ ببيئة الاختبار. المضيفان يختلفان في المسارات أكثر مما يتوقع أحد.</li>
        </ol>
      </section>

      {view.providers.map((provider) => (
        <section className="panel" key={provider} data-role="provider-endpoints">
          <div className="panel-header">
            <h2>{provider}</h2>
            <span className="muted">{view.required.length} نقطة تطلبها الوحدات</span>
          </div>

          <div className="panel-body stack" style={{ gap: 'var(--s-5)' }}>
            {ENVIRONMENTS.map((environment) => (
              <div key={environment} className="stack" data-environment={environment}>
                <strong>{ENVIRONMENT_LABELS[environment]}</strong>

                {view.required.map((endpoint) => {
                  const row = rowFor(provider, environment, endpoint);
                  return (
                    <form
                      key={endpoint}
                      action={setEndpointAction}
                      className="row"
                      data-endpoint={endpoint}
                      style={{ gap: 'var(--s-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}
                    >
                      <input type="hidden" name="provider" value={provider} />
                      <input type="hidden" name="environment" value={environment} />
                      <input type="hidden" name="endpoint" value={endpoint} />

                      <span className="mono" style={{ minWidth: '18ch' }}>
                        {endpoint}
                      </span>
                      <select
                        name="method"
                        defaultValue={row?.method ?? 'GET'}
                        aria-label="الطريقة"
                        style={{ width: 'auto' }}
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                      </select>
                      <input
                        name="path"
                        defaultValue={row?.path ?? ''}
                        placeholder="/v1/..."
                        dir="ltr"
                        className="mono"
                        aria-label="المسار"
                        style={{ width: 'auto' }}
                      />
                      <input
                        name="authority"
                        defaultValue={row?.authority ?? ''}
                        placeholder="الجهة الرسمية"
                        aria-label="الجهة"
                        style={{ width: 'auto' }}
                      />
                      <input
                        name="data_path"
                        defaultValue={row?.dataPath ?? ''}
                        placeholder="data"
                        dir="ltr"
                        className="mono"
                        aria-label="مسار البيانات"
                        style={{ width: '10ch' }}
                      />
                      <input
                        name="field_map"
                        defaultValue={Object.entries(row?.fieldMap ?? {})
                          .map(([theirs, ours]) => `${theirs}=${ours}`)
                          .join(', ')}
                        placeholder="cityName=city, districtName=district"
                        dir="ltr"
                        className="mono"
                        aria-label="خريطة الحقول"
                        style={{ width: 'auto', flex: 1, minWidth: '220px' }}
                      />
                      <button type="submit" className="btn-secondary" data-role="save-endpoint">
                        حفظ
                      </button>
                      <span className="muted" data-role="endpoint-state">
                        {row ? 'مضبوطة' : 'غير مضبوطة'}
                      </span>
                    </form>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
