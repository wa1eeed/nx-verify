'use client';

import { useActionState, type ReactElement } from 'react';
import { EVENT_TYPES, eventLabelAr as labelOf } from './events';
import { EmptyState, PageHeader, Panel } from './page-header';
import { SubmitButton } from './ui/submit-button';
import { Ltr } from './ui/ltr';

/**
 * The addresses we call when something happens (ADR-147).
 *
 * The delivery pipeline has existed since the webhooks unit: an event is queued on every
 * completed verification, signed, retried with a backoff and abandoned after the last
 * attempt. It ran against a permanently empty table, because nothing could register an
 * endpoint and this tab offered only API keys while being named for both.
 *
 * Three things the screen insists on, each because of a way this goes wrong.
 *
 * The signing secret is **ours to generate**. It is what makes a delivery provable, so its
 * quality is not something to leave to whatever somebody types into a box. It is shown once
 * and never again, like an API key, because the whole point of a signature is that exactly
 * two parties hold the secret.
 *
 * The address must be `https`. We call it, and plain HTTP would put a signed payload about
 * somebody's customer on the wire in the clear. The table refuses it too.
 *
 * And an endpoint is paused, never deleted. Deliveries already queued carry its id and what
 * was sent is a fact; the secret survives the pause, so switching back on does not mean
 * changing a secret in somebody else's system, which is a thing nobody ever gets round to.
 */

export interface EndpointView {
  id: string;
  url: string;
  events: string[];
  status: string;
  /**
   * How this address is actually doing (ADR-169).
   *
   * `webhook_deliveries` recorded every attempt and nothing read it, so a subscriber registered
   * an address and was blind to whether one event had ever arrived. That is the worst shape a
   * failure can take here: we give up after the retries and record that we gave up, the
   * integration on the other end simply goes quiet, and somebody notices weeks later when a
   * customer asks why an alert never came.
   */
  health: {
    delivered: number;
    failing: number;
    abandoned: number;
    pending: number;
    lastDeliveredAt: Date | null;
    lastStatus: number | null;
  } | null;
}

export interface IssuedSecretState {
  /** The signing secret, once, straight after registering. Never fetched, never stored. */
  secret: string | null;
  refused: 'url' | 'events' | 'readonly' | 'failed' | null;
}

const NOTHING: IssuedSecretState = { secret: null, refused: null };



const REFUSALS: Record<NonNullable<IssuedSecretState['refused']>, string> = {
  url: 'العنوان يجب أن يبدأ بـ https. نحن من ينادي هذا العنوان، وبلا تشفير تمر حمولة موقّعة عن عميل مكشوفة.',
  events: 'اختر حدثاً واحداً على الأقل.',
  readonly: 'مخزن الأسرار للقراءة فقط في هذا النشر، فلا يمكن حفظ مفتاح توقيع.',
  failed: 'لم يُسجَّل العنوان. حاول مرة أخرى.',
};

/**
 * Delivery in one cell: what arrived, what is still trying, and what we gave up on.
 *
 * «متروك» is the one that matters and is named separately from «متعثر» for that reason: a
 * failing delivery is still being retried, an abandoned one is past the schedule and is never
 * coming back by itself. Folding them together would hide the only state a person has to act on.
 */
function DeliveryCell({ health }: { health: EndpointView['health'] }): ReactElement {
  if (health === null || health.delivered + health.failing + health.abandoned + health.pending === 0) {
    return <span className="muted">لم يُرسَل شيء بعد</span>;
  }

  return (
    <span className="stack" style={{ gap: 0 }}>
      <span className="row" style={{ gap: 'var(--s-2)', flexWrap: 'wrap' }}>
        <span data-role="delivered">
          وصل <Ltr>{health.delivered}</Ltr>
        </span>
        {health.pending > 0 ? (
          <span className="muted" data-role="pending">
            · قيد المحاولة <Ltr>{health.pending}</Ltr>
          </span>
        ) : null}
        {health.abandoned > 0 ? (
          <span className="badge" data-tone="critical" data-role="abandoned">
            تُرك <Ltr>{health.abandoned}</Ltr>
          </span>
        ) : null}
      </span>
      {health.lastStatus === null ? null : (
        <span className="faint" data-role="last-status">
          آخر رد من عنوانك: <Ltr>{health.lastStatus}</Ltr>
        </span>
      )}
    </span>
  );
}

export function eventLabelAr(eventType: string): string {
  return labelOf(eventType);
}

/** The signing secret, in the one place it exists in plain text. */
export function IssuedSigningSecret({ secret }: { secret: string }): ReactElement {
  return (
    <section className="card stack" data-role="issued-secret">
      <strong>مفتاح التوقيع</strong>
      <bdi dir="ltr" className="mono" data-role="secret-value" style={{ wordBreak: 'break-all' }}>
        {secret}
      </bdi>
      <p className="muted">
        انسخه الآن. لا يُعرض مرة أخرى ولا يمكننا استخراجه. به تتحقق من أن النداء منّا نحن: نوقّع كل
        تسليم، وترويسة التوقيع تحمل البصمة. فقده يعني تسجيل عنوان جديد.
      </p>
    </section>
  );
}

export function Webhooks({
  endpoints,
  addAction,
  pauseAction,
  resumeAction,
}: {
  endpoints: EndpointView[];
  addAction: (previous: IssuedSecretState, formData: FormData) => Promise<IssuedSecretState>;
  pauseAction: (formData: FormData) => void | Promise<void>;
  resumeAction: (formData: FormData) => void | Promise<void>;
}): ReactElement {
  const [state, formAction] = useActionState(addAction, NOTHING);

  return (
    <section className="stack" data-role="webhooks" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="الـ Webhooks"
        subtitle="عناوين نناديها عند وقوع حدث، موقّعة، مع إعادة محاولة."
      />

      {state.secret === null ? null : <IssuedSigningSecret secret={state.secret} />}
      {state.refused === null ? null : (
        <p className="notice notice-refused" data-role="webhook-refused" style={{ margin: 0 }}>
          {REFUSALS[state.refused]}
        </p>
      )}

      <p className="card muted" data-role="payload-notice">
        الحمولة تقول إن شيئاً وقع وأين يُنظر إليه، ولا تحمل معرّفاً صريحاً ولا اسم جهة مزوّدة. ونعيد
        المحاولة بفواصل متباعدة، ثم نتوقف ونسجّل أننا توقفنا.
      </p>

      <Panel title="تسجيل عنوان">
        <form action={formAction} className="panel-body stack" style={{ gap: 'var(--s-3)' }}>
          <label className="stack" style={{ gap: 'var(--s-1)' }}>
            <span className="stat-label">العنوان</span>
            <input
              name="url"
              type="url"
              dir="ltr"
              required
              placeholder="https://api.example.sa/nx-hooks"
            />
          </label>
          <fieldset
            className="stack"
            style={{ gap: 'var(--s-2)', border: 0, padding: 0, margin: 0 }}
          >
            <legend className="stat-label">الأحداث</legend>
            <div className="row" style={{ gap: 'var(--s-4)', flexWrap: 'wrap' }}>
              {EVENT_TYPES.map((value) => (
                <label key={value} className="row" style={{ gap: 'var(--s-2)' }}>
                  {/* Nothing ticked by default: what leaves this platform is a decision. */}
                  <input type="checkbox" name="events" value={value} />
                  <span>{labelOf(value)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <SubmitButton data-role="add-endpoint" pendingLabel="جارٍ التسجيل">
              سجّل العنوان
            </SubmitButton>
          </div>
        </form>
      </Panel>

      {endpoints.length === 0 ? (
        <EmptyState>لا عناوين مسجّلة. لا يُنادى أحد حتى تسجّل واحداً.</EmptyState>
      ) : (
        <Panel title="العناوين" aside={`${endpoints.length}`}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>العنوان</th>
                  <th>الأحداث</th>
                  <th>التسليم آخر 30 يوماً</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {endpoints.map((endpoint) => (
                  <tr key={endpoint.id} data-role="endpoint" data-item={endpoint.id}>
                    <td>
                      <bdi dir="ltr" className="mono" style={{ wordBreak: 'break-all' }}>
                        {endpoint.url}
                      </bdi>
                    </td>
                    <td>{endpoint.events.map(eventLabelAr).join('، ')}</td>
                    {/*
                      What actually arrived. Registering an address and being unable to tell
                      whether one event ever landed is the worst shape a failure takes here:
                      we stop after the retries, and the other end simply goes quiet (ADR-169).
                    */}
                    <td data-role="endpoint-health">
                      <DeliveryCell health={endpoint.health} />
                    </td>
                    <td>
                      <span className="badge" data-status={endpoint.status}>
                        {endpoint.status === 'active' ? 'يعمل' : 'موقوف، ولا يُنادى'}
                      </span>
                    </td>
                    <td>
                      <form action={endpoint.status === 'active' ? pauseAction : resumeAction}>
                        <input type="hidden" name="endpoint_id" value={endpoint.id} />
                        <SubmitButton
                          variant="ghost"
                          data-role={
                            endpoint.status === 'active' ? 'pause-endpoint' : 'resume-endpoint'
                          }
                          pendingLabel="جارٍ الحفظ"
                        >
                          {endpoint.status === 'active' ? 'أوقف' : 'شغّل'}
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </section>
  );
}
