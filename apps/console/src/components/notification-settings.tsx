import type { ReactElement } from 'react';
import {
  EVENT_SEVERITY,
  EVENT_TYPES,
  SEVERITY_LABELS_AR,
  eventLabelAr as labelOf,
} from './events';
import { EmptyState, PageHeader, Panel } from './page-header';
import { SubmitButton } from './ui/submit-button';

/**
 * Who gets told what.
 *
 * The screen states plainly what a message contains, because the person choosing
 * recipients here is deciding who receives mail from us, and they should know before they
 * choose that the mail says nothing about the subject of a verification. Saying it once
 * on this screen is worth more than saying it in a policy nobody reads.
 *
 * And an address is proved before it is told anything (ADR-145). Typing an address claims
 * nothing: this is the one place in the console where a subscriber can point our platform at
 * somebody else's mailbox, so the mailbox gets a say. The screen is honest about the order,
 * which is why the subscription controls appear only after the proof.
 */

export interface ChannelView {
  id: string;
  address: string;
  displayName: string | null;
  verified: boolean;
  status: string;
  awaitingProof: boolean;
  events: { ruleId: string; eventType: string; minSeverity: string }[];
}





/** What the last action did, read from the address the action sent the screen to. */
const OUTCOMES: Record<string, { tone: 'done' | 'refused'; text: string }> = {
  sent: { tone: 'done', text: 'أُرسل رمز الإثبات. أدخله أدناه، وينتهي بعد نصف ساعة.' },
  proved: { tone: 'done', text: 'أُثبت العنوان. اختر الأحداث التي يُخطَر بها.' },
  removed: { tone: 'done', text: 'أُزيل العنوان، وأُوقفت اشتراكاته.' },
  subscribed: { tone: 'done', text: 'حُفظ الاشتراك.' },
  unsubscribed: { tone: 'done', text: 'أُوقف الاشتراك.' },
  address: { tone: 'refused', text: 'لم يُضف شيء: راجع البريد المكتوب.' },
  duplicate: { tone: 'refused', text: 'هذا العنوان مسجّل بالفعل.' },
  code: { tone: 'refused', text: 'الرمز غير صحيح أو انتهت مدته. اطلب رمزاً جديداً.' },
  'too-soon': { tone: 'refused', text: 'أُرسل رمز قبل قليل. انتظر دقيقة ثم اطلب غيره.' },
  mail: {
    tone: 'refused',
    text: 'تعذّر إرسال رمز الإثبات. حاول لاحقاً، وإن تكرر فراجع مشغّل المنصة.',
  },
  failed: { tone: 'refused', text: 'لم يُحفظ التغيير. حاول مرة أخرى.' },
};

export function eventLabel(eventType: string): string {
  return labelOf(eventType);
}

export function outcomeNotice(
  outcome: string | undefined,
): { tone: 'done' | 'refused'; text: string } | null {
  return outcome === undefined ? null : (OUTCOMES[outcome] ?? null);
}

type Action = string | ((formData: FormData) => void | Promise<void>);

export interface NotificationSettingsProps {
  channels: ChannelView[];
  /** The address the last action reported on, so its card is the one that shows the field. */
  outcome?: string | undefined;
  focusChannel?: string | undefined;
  addAction: Action;
  proveAction: Action;
  resendAction: Action;
  removeAction: Action;
  subscribeAction: Action;
  unsubscribeAction: Action;
}

export function NotificationSettings({
  channels,
  outcome,
  focusChannel,
  addAction,
  proveAction,
  resendAction,
  removeAction,
  subscribeAction,
  unsubscribeAction,
}: NotificationSettingsProps): ReactElement {
  const notice = outcomeNotice(outcome);
  const live = channels.filter((channel) => channel.status === 'active');

  return (
    <section className="stack" data-role="notification-settings" style={{ gap: 'var(--s-5)' }}>
      <PageHeader title="الإشعارات" subtitle="من يُخطَر، وعند أي حدث." />

      {notice === null ? null : (
        <p
          className={`notice notice-${notice.tone === 'done' ? 'done' : 'refused'}`}
          data-role="outcome"
          data-tone={notice.tone}
          style={{ margin: 0 }}
        >
          {notice.text}
        </p>
      )}

      <p className="card muted" data-role="content-notice">
        رسالة التنبيه تقول إن شيئاً حدث وأين يُنظر إليه، ولا تحمل أي معرّف ولا اسم جهة مزوّدة ولا
        قيمة حقل. التفاصيل في الكونسول وحده.
      </p>

      <Panel title="إضافة عنوان">
        <form
          action={addAction}
          className="stack"
          data-role="add-channel"
          style={{ gap: 'var(--s-3)' }}
        >
          <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
            <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '220px' }}>
              <span className="stat-label">البريد</span>
              <input name="address" type="email" dir="ltr" required placeholder="ops@example.sa" />
            </label>
            <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '180px' }}>
              <span className="stat-label">الاسم، اختياري</span>
              <input name="display_name" placeholder="فريق العمليات" />
            </label>
          </div>
          <span className="stat-hint">
            يُرسل رمز إلى العنوان أولاً، ولا يُخطَر بشيء قبل إدخال ذلك الرمز.
          </span>
          <div>
            <SubmitButton data-role="add-channel-submit" pendingLabel="جارٍ الإرسال">
              إضافة وإرسال رمز
            </SubmitButton>
          </div>
        </form>
      </Panel>

      {live.length === 0 ? (
        <EmptyState>لا عناوين مسجّلة بعد. لا يُرسَل شيء قبل إثبات العنوان.</EmptyState>
      ) : (
        <Panel title="العناوين" aside={`${live.length} عنواناً`}>
          <div className="stack" style={{ gap: 'var(--s-4)' }}>
            {live.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                open={channel.id === focusChannel}
                proveAction={proveAction}
                resendAction={resendAction}
                removeAction={removeAction}
                subscribeAction={subscribeAction}
                unsubscribeAction={unsubscribeAction}
              />
            ))}
          </div>
        </Panel>
      )}
    </section>
  );
}

function ChannelCard({
  channel,
  open,
  proveAction,
  resendAction,
  removeAction,
  subscribeAction,
  unsubscribeAction,
}: {
  channel: ChannelView;
  open: boolean;
  proveAction: Action;
  resendAction: Action;
  removeAction: Action;
  subscribeAction: Action;
  unsubscribeAction: Action;
}): ReactElement {
  const subscribed = new Set(channel.events.map((rule) => rule.eventType));
  const remaining = EVENT_TYPES.filter((event) => !subscribed.has(event));

  return (
    <article
      className="stack channel-card"
      data-role="channel"
      data-item={channel.id}
      style={{ gap: 'var(--s-3)' }}
    >
      <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <bdi dir="ltr" className="mono">
          {channel.address}
        </bdi>
        {channel.displayName ? <span className="muted">{channel.displayName}</span> : null}
        {channel.verified ? (
          <span className="badge" data-role="verified">
            مُثبَت
          </span>
        ) : (
          // Unproved addresses receive nothing, and the screen says so rather than leaving
          // someone to wonder why no mail arrives.
          <span className="badge" data-role="unverified">
            غير مُثبَت، ولا يُرسَل إليه
          </span>
        )}
        <form action={removeAction} style={{ marginInlineStart: 'auto' }}>
          <input type="hidden" name="channel_id" value={channel.id} />
          <SubmitButton variant="secondary" data-role="remove-channel" pendingLabel="جارٍ الإزالة">
            إزالة
          </SubmitButton>
        </form>
      </div>

      {channel.verified ? null : (
        <form
          action={proveAction}
          className="row"
          data-role="prove-channel"
          style={{ gap: 'var(--s-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <input type="hidden" name="channel_id" value={channel.id} />
          <label className="stack" style={{ gap: 'var(--s-1)' }}>
            <span className="stat-label">رمز الإثبات</span>
            <input
              name="code"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              // The field opens focused on the address the last action reported on, so a
              // person who just added one types straight into the right box.
              autoFocus={open}
              style={{ width: '9ch' }}
            />
          </label>
          <SubmitButton data-role="prove-submit" pendingLabel="جارٍ الإثبات">
            إثبات
          </SubmitButton>
          <span data-role="resend">
            <SubmitButton variant="ghost" formAction={resendAction} pendingLabel="جارٍ الإرسال">
              إرسال رمز جديد
            </SubmitButton>
          </span>
        </form>
      )}

      {channel.verified ? (
        <div className="stack" style={{ gap: 'var(--s-2)' }}>
          {channel.events.length === 0 ? (
            <span className="muted">لا اشتراكات</span>
          ) : (
            <ul className="stack" style={{ gap: 'var(--s-1)', margin: 0 }}>
              {channel.events.map((rule) => (
                <li key={rule.ruleId} className="row" style={{ gap: 'var(--s-2)' }}>
                  <span>{eventLabel(rule.eventType)}</span>
                  {/* The event's own severity, which is the fact. The old line printed the
                      rule's minimum, a number that only ever silenced the rule or did nothing. */}
                  <span className="muted">
                    ·{' '}
                    {SEVERITY_LABELS_AR[
                      EVENT_SEVERITY[rule.eventType as keyof typeof EVENT_SEVERITY]
                    ] ?? ''}
                  </span>
                  <form action={unsubscribeAction}>
                    <input type="hidden" name="rule_id" value={rule.ruleId} />
                    <SubmitButton
                      variant="ghost"
                      data-role="unsubscribe"
                      pendingLabel="جارٍ الإيقاف"
                    >
                      إيقاف
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}

          {remaining.length === 0 ? null : (
            <form
              action={subscribeAction}
              className="row"
              data-role="subscribe"
              style={{ gap: 'var(--s-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}
            >
              <input type="hidden" name="channel_id" value={channel.id} />
              <label className="stack" style={{ gap: 'var(--s-1)' }}>
                <span className="stat-label">الحدث</span>
                <select name="event_type" style={{ width: 'auto' }}>
                  {remaining.map((event) => (
                    <option key={event} value={event}>
                      {labelOf(event)} · {SEVERITY_LABELS_AR[EVENT_SEVERITY[event]]}
                    </option>
                  ))}
                </select>
              </label>
              {/*
                No «من درجة» any more. Every event carries one fixed severity, so a floor above
                it silenced the subscription completely and a floor below it did nothing, while
                the screen listed the rule as active either way (ADR-165). What the reader
                actually needs is the event's own severity, which is shown beside its name.
              */}
              <input type="hidden" name="min_severity" value="INFO" />
              <SubmitButton data-role="subscribe-submit" pendingLabel="جارٍ الحفظ">
                اشتراك
              </SubmitButton>
            </form>
          )}
        </div>
      ) : null}
    </article>
  );
}
