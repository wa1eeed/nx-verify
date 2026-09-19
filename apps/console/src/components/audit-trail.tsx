import Link from 'next/link';
import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';
import { isoDate, timeOfDay } from './format';

/**
 * Who did what, in this workspace (ADR-150).
 *
 * `audit()` is written on dozens of paths and `readAudit` had no caller in any application,
 * so the trail was recorded and unreadable: a compliance question about who shared a
 * customer's file, or who changed a decision rule, had no answer short of somebody with a
 * database connection. A log nobody can read is a log that does not exist for the purpose it
 * was built for.
 *
 * Two things the screen keeps.
 *
 * It says who in words. An actor is an identity, not a string (ADR-038), so a row shows the
 * person's name and the row keeps their id; «API_KEY» shows the key's prefix rather than a
 * uuid nobody can match to anything.
 *
 * And it shows metadata as it was stored, which is to say **already redacted**: the entries
 * pass through the redaction layer on the way in, because an audit trail that leaks
 * identifiers is itself a finding.
 */

export interface AuditRowView {
  id: string;
  actorType: 'USER' | 'API_KEY' | 'SYSTEM' | 'NX_STAFF';
  actorId: string;
  /** The person's or key's readable name, where one could be found. */
  actorName: string | null;
  action: string;
  target: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

const ACTOR_LABELS: Record<AuditRowView['actorType'], string> = {
  USER: 'مستخدم',
  API_KEY: 'مفتاح ربط',
  SYSTEM: 'النظام',
  NX_STAFF: 'فريق المنصة',
};

/**
 * What each recorded action was, in words.
 *
 * Only the actions this platform writes. An action nobody named shows its own code rather
 * than disappearing: a trail that silently drops what it cannot label is a trail with holes
 * exactly where something unusual happened.
 */
const ACTION_LABELS: Record<string, string> = {
  /*
   * Every action the domain writes needs a word here, or an Arabic reader gets the English
   * code. The list had labels for two events nothing wrote and no label for eighteen it did
   * (ADR-167), which is what happens when a screen's vocabulary is maintained by hand beside
   * a set of call sites nothing holds it against. A test now holds the two equal.
   */
  'user.role_changed': 'غيّر دور مستخدم',
  'user.enabled': 'أعاد تفعيل مستخدم',
  'user.capability.set': 'غيّر صلاحية لمستخدم',
  'user.capability.reset': 'أعاد صلاحيات مستخدم إلى دوره',
  'monitor.paused': 'أوقف مراقبة',
  'monitor.resumed': 'استأنف مراقبة',
  'monitor.budget_changed': 'غيّر سقف إنفاق مراقبة',
  'sso.domain_claimed': 'سجّل نطاقاً للدخول الموحّد',
  'sso.domain_verified': 'أثبت نطاق الدخول الموحّد',
  'sso.domain_removed': 'أزال نطاقاً من الدخول الموحّد',
  'portfolio.member_added': 'أضاف عميلاً إلى مجموعة',
  'portfolio.member_removed': 'أزال عميلاً من مجموعة',
  'onboarding.step_waived': 'تنازل عن خطوة تأهيل',
  'settings.updated': 'غيّر إعدادات مساحة العمل',
  'preferences.updated': 'غيّر التفضيلات',
  'batch.confirmed': 'أكّد دفعة تحقق',
  'batch.cancelled': 'ألغى دفعة تحقق',
  'tenant.registered': 'أنشأ مساحة العمل',
  'relation.ended': 'أنهى صفة طرف في منشأة',
  'verification.created': 'طلب تحقق',
  'verification.replayed': 'أُعيد نفس الطلب',
  'profile.shared': 'شارك ملف عميل',
  'profile.share_revoked': 'سحب مشاركة ملف',
  'change.acknowledged': 'أغلق تغيّراً مرصوداً',
  'review.assigned': 'أسند حالة مراجعة',
  'review.decided': 'قرّر حالة مراجعة',
  'review.approved': 'اعتمد قراراً',
  'review.returned': 'أعاد حالة إلى المقرِّر',
  'freshness.set': 'غيّر مدة صلاحية',
  'freshness.cleared': 'أعاد مدة إلى الافتراضي',
  'notification.channel_added': 'أضاف عنوان تنبيهات',
  'notification.proof_sent': 'أرسل رمز إثبات عنوان',
  'notification.channel_proved': 'أثبت عنوان تنبيهات',
  'notification.channel_removed': 'أزال عنوان تنبيهات',
  'notification.subscribed': 'اشترك في حدث',
  'notification.unsubscribed': 'أوقف اشتراكاً',
  'webhook.registered': 'سجّل عنوان webhook',
  'webhook.paused': 'أوقف عنوان webhook',
  'webhook.resumed': 'شغّل عنوان webhook',
  'portfolio.created': 'أنشأ مجموعة',
  'portfolio.ttl_set': 'ضبط مدة لمجموعة',
  'ruleset.forked': 'نسخ مجموعة قواعد',
  'ruleset.rule_changed': 'غيّر نتيجة قاعدة',
  'onboarding.opened': 'فتح ملف تأهيل',
  'onboarding.advanced': 'شغّل فحوص ملف تأهيل',
  'onboarding.waived': 'تجاوز فحصاً في ملف تأهيل',
  'apikey.issued': 'أصدر مفتاح ربط',
  'apikey.revoked': 'ألغى مفتاح ربط',
  'user.created': 'أضاف مستخدماً',
  'user.disabled': 'عطّل مستخدماً',
  'sso.configured': 'ضبط الدخول الموحّد',
  'user.password_set': 'ضُبطت كلمة مرور',
  // Written into a subscriber's own trail by the platform, because it happened to their
  // workspace. Naming them here is the difference between a trail a subscriber reads and one
  // they scroll past.
  'retention.enforced': 'نفّذ النظام سياسة الاحتفاظ',
  'package.assigned': 'أُسندت باقة إلى مساحة العمل',
  'module.set': 'فُعّل أو عُطّل موديول',
  'risk.signal_set': 'عُدّل مؤشر مخاطر',
  'provider.connection_set': 'ضُبط اتصال مصدر بيانات',
  'provider.binding_set': 'ضُبط توجيه مصدر بيانات',
  'provider.health_changed': 'تغيّرت حالة مصدر بيانات',
  'onboarding.in_review': 'ملف تأهيل يحتاج مراجعة',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** The metadata of a row, as one line. Never a value the redaction layer removed. */
export function metadataLine(metadata: Record<string, unknown> | null): string {
  if (metadata === null) {
    return '';
  }
  return Object.entries(metadata)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
    )
    .join(' · ');
}

export function AuditTrail({
  rows,
  action,
  actions,
  from,
  to,
  more = false,
  nextBefore = null,
}: {
  rows: AuditRowView[];
  /** The action filter in force, if any. */
  action?: string | undefined;
  /** Every action this workspace's trail actually contains, for the filter. */
  actions: string[];
  /** The window in force, as days, or undefined for «since the beginning». */
  from?: string | undefined;
  to?: string | undefined;
  /**
   * Whether the trail has more than this page (ADR-169).
   *
   * It used to ask for two hundred rows and print the count beside the title, so a truncated
   * list and a complete one looked identical and a question about last quarter had no answer.
   */
  more?: boolean;
  /** Where the next page starts: the id of the oldest row shown. */
  nextBefore?: string | null;
}): ReactElement {
  const params = (over: Record<string, string | undefined>): string => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ action, from, to, ...over })) {
      if (value !== undefined && value !== '') {
        search.set(key, value);
      }
    }
    const query = search.toString();
    return query === '' ? '/settings/audit' : `/settings/audit?${query}`;
  };

  return (
    <section className="stack" data-role="audit-trail" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="سجل التدقيق"
        subtitle="من فعل ماذا في مساحة عملك، ومتى. القراءات تُسجَّل كما تُسجَّل التغييرات."
      />

      <p className="card muted" data-role="redaction-notice">
        تفاصيل كل سطر تمر بطبقة الإخفاء قبل تخزينها: لا رقم هوية ولا سجل تجاري ولا رمز مشاركة في هذا
        السجل. سجلٌّ يسرّب معرّفاً هو نفسه مخالفة.
      </p>

      {actions.length === 0 ? null : (
        <nav
          className="row"
          data-role="audit-filter"
          style={{ gap: 'var(--s-2)', flexWrap: 'wrap' }}
        >
          <Link
            className={`btn ${action === undefined ? 'btn-secondary' : 'btn-ghost'}`}
            href={params({ action: undefined, before: undefined })}
          >
            الكل
          </Link>
          {actions.map((code) => (
            <Link
              key={code}
              className={`btn ${action === code ? 'btn-secondary' : 'btn-ghost'}`}
              href={params({ action: code, before: undefined })}
            >
              {actionLabel(code)}
            </Link>
          ))}
        </nav>
      )}

      {/*
        A window, because the trail is read years later and «the last two hundred rows» is not
        an answer to «what happened in March». A plain GET, so the range is in the address and
        can be sent to somebody.
      */}
      <form
        method="get"
        action="/settings/audit"
        className="row"
        data-role="audit-window"
        style={{ gap: 'var(--s-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}
      >
        {action === undefined ? null : <input type="hidden" name="action" value={action} />}
        <label className="stack" style={{ gap: 'var(--s-1)' }}>
          <span className="stat-label">من</span>
          <input type="date" name="from" defaultValue={from ?? ''} dir="ltr" />
        </label>
        <label className="stack" style={{ gap: 'var(--s-1)' }}>
          <span className="stat-label">إلى</span>
          <input type="date" name="to" defaultValue={to ?? ''} dir="ltr" />
        </label>
        <button type="submit" className="btn btn-secondary" data-role="audit-window-apply">
          اعرض المدة
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState>لا شيء مسجّل بعد لهذا الفرز.</EmptyState>
      ) : (
        <Panel title="آخر ما جرى" aside={more ? `${rows.length}+` : `${rows.length}`}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>متى</th>
                  <th>من</th>
                  <th>ماذا</th>
                  <th>التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-role="audit-row" data-action={row.action}>
                    {/*
                      Both halves come from the shared formatters, which are one clock. This
                      cell used to stack a UTC date over a Riyadh time, so anything recorded
                      between 21:00 and midnight UTC showed yesterday's date above today's
                      hour: a compliance answer that was wrong by a day for three hours of
                      every day.
                    */}
                    <td>
                      <bdi dir="ltr" className="mono">
                        {isoDate(row.createdAt)}
                      </bdi>
                      <div className="faint">
                        <bdi dir="ltr" className="mono">
                          {timeOfDay(row.createdAt)}
                        </bdi>
                      </div>
                    </td>
                    <td>
                      {row.actorName ?? ACTOR_LABELS[row.actorType]}
                      <div className="faint">{ACTOR_LABELS[row.actorType]}</div>
                    </td>
                    <td>{actionLabel(row.action)}</td>
                    <td className="muted" style={{ wordBreak: 'break-word' }}>
                      {metadataLine(row.metadata)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/*
            A cursor, not an offset: the trail grows while somebody reads it, and an offset
            would skip or repeat rows as it does.
          */}
          {more && nextBefore !== null ? (
            <div className="row" style={{ gap: 'var(--s-3)', padding: 'var(--s-3)' }}>
              <Link
                className="btn btn-secondary"
                href={params({ before: nextBefore })}
                data-role="audit-older"
              >
                أقدم من ذلك
              </Link>
            </div>
          ) : null}
        </Panel>
      )}
    </section>
  );
}
