import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';

/**
 * Who gets told what.
 *
 * The screen states plainly what a message contains, because the person choosing
 * recipients here is deciding who receives mail from us, and they should know before they
 * choose that the mail says nothing about the subject of a verification. Saying it once
 * on this screen is worth more than saying it in a policy nobody reads.
 */

export interface ChannelView {
  id: string;
  address: string;
  displayName: string | null;
  verified: boolean;
  status: string;
  events: { ruleId: string; eventType: string; minSeverity: string }[];
}

const EVENT_LABELS: Record<string, string> = {
  'verification.completed': 'اكتمال تحقق',
  'entity.changed': 'تغيّر مرصود',
  'attestation.expired': 'انتهاء صلاحية معرفة',
  'wallet.low': 'انخفاض رصيد الخدمات',
};

const SEVERITY_LABELS: Record<string, string> = {
  INFO: 'كل الأحداث',
  WARNING: 'التحذيرات فما فوق',
  CRITICAL: 'الحرجة فقط',
};

export function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType;
}

export function NotificationSettings({ channels }: { channels: ChannelView[] }): ReactElement {
  return (
    <section className="stack" data-role="notification-settings" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="التنبيهات"
        subtitle="من يُخطَر، وبماذا. والرسالة نفسها لا تحمل تفاصيل."
      />

      <p className="card muted" data-role="content-notice">
        رسالة التنبيه تقول إن شيئاً حدث وأين يُنظر إليه، ولا تحمل أي معرّف ولا اسم جهة
        مزوّدة ولا قيمة حقل. التفاصيل في الكونسول وحده.
      </p>

      {channels.length === 0 ? (
        <EmptyState>لا عناوين مسجّلة بعد. لا يُرسَل شيء قبل إثبات العنوان.</EmptyState>
      ) : (
        <Panel title="العناوين" aside={`${channels.length} عنواناً`}>
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>العنوان</th>
              <th>الحالة</th>
              <th>الأحداث</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr key={channel.id} data-role="channel">
                <td>
                  <bdi dir="ltr" className="mono">
                    {channel.address}
                  </bdi>
                  {channel.displayName ? <div className="muted">{channel.displayName}</div> : null}
                </td>
                <td>
                  {channel.verified ? (
                    <span className="badge" data-role="verified">
                      مُثبَت
                    </span>
                  ) : (
                    // Unproved addresses receive nothing, and the screen says so rather
                    // than leaving someone to wonder why no mail arrives.
                    <span className="badge" data-role="unverified">
                      غير مُثبَت، ولا يُرسَل إليه
                    </span>
                  )}
                </td>
                <td>
                  {channel.events.length === 0 ? (
                    <span className="muted">لا اشتراكات</span>
                  ) : (
                    <ul>
                      {channel.events.map((rule) => (
                        <li key={rule.ruleId}>
                          {eventLabel(rule.eventType)}
                          <span className="muted">
                            {' '}
                            · {SEVERITY_LABELS[rule.minSeverity] ?? rule.minSeverity}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
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
