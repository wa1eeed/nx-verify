import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { nextRetryAt } from '../webhooks/signing.js';
import type { WebhookEventType } from '../webhooks/dispatch.js';

/**
 * Telling a person.
 *
 * Webhooks carry every event to the customer's systems, which serves the integrator and
 * nobody else. The compliance officer who needs to know that a record in their portfolio
 * changed does not read a webhook.
 *
 * One rule shapes everything here, and it is the reason the message templates take almost
 * nothing from the event: a notification leaves our custody. It lands in an inbox we do
 * not control, passes through mail servers we have never seen, and gets forwarded by
 * people we will never meet. So a message says that something happened and where to look
 * at it, and never what was found. No identifier (rule 4), no provider name (rule 5), no
 * field value, no decision. The message is a pointer, and the console is the document.
 *
 * See ADR-054.
 */

export type NotificationSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

const SEVERITY_ORDER: Record<NotificationSeverity, number> = {
  INFO: 0,
  WARNING: 1,
  CRITICAL: 2,
};

export interface NotificationChannel {
  id: string;
  kind: 'EMAIL';
  address: string;
  displayName: string | null;
  verified: boolean;
  status: 'active' | 'disabled';
}

export interface Message {
  subject: string;
  body: string;
  severity: NotificationSeverity;
}

/**
 * What each event says.
 *
 * Written out here, once, rather than composed from the event payload at the call site.
 * A template that interpolates the payload is one careless change away from putting a
 * national id in an email, and the person making that change will not be reading this
 * comment.
 */
const TEMPLATES: Record<WebhookEventType, (consoleUrl: string) => Message> = {
  'verification.completed': (url) => ({
    severity: 'INFO',
    subject: 'اكتمل تحقق في NX Verify',
    body: [
      'اكتمل تحقق في مساحة عملك.',
      '',
      `التفاصيل في السجل: ${url}/registry`,
      '',
      'هذه الرسالة لا تحتوي على أي بيانات عن موضوع التحقق. افتح الكونسول للاطلاع.',
    ].join('\n'),
  }),
  'entity.changed': (url) => ({
    severity: 'WARNING',
    subject: 'تغيّر مرصود على كيان مراقَب',
    body: [
      'رصدت المراقبة تغيّراً على كيان في إحدى محافظك.',
      '',
      `افتح لوحة المخاطر: ${url}/dashboard`,
      '',
      'هذه الرسالة لا تذكر الكيان ولا ما تغيّر. افتح الكونسول للاطلاع.',
    ].join('\n'),
  }),
  'attestation.expired': (url) => ({
    severity: 'WARNING',
    subject: 'انتهت صلاحية معرفة في NX Verify',
    body: [
      'انتهت صلاحية إحدى المعارف في مساحة عملك، وتحتاج تحققاً جديداً.',
      '',
      `افتح السجل: ${url}/registry`,
    ].join('\n'),
  }),
  'wallet.low': (url) => ({
    severity: 'CRITICAL',
    subject: 'رصيد الخدمات منخفض',
    body: [
      'رصيد الخدمات في مساحة عملك اقترب من الحد الأدنى، وقد تتوقف عمليات التحقق.',
      '',
      `افتح الإعدادات لشحن الرصيد: ${url}/settings/freshness`,
    ].join('\n'),
  }),
};

export function renderMessage(eventType: WebhookEventType, consoleUrl: string): Message {
  const template = TEMPLATES[eventType];
  if (!template) {
    throw new NxError('NX-5001', { detail: 'no notification template for this event' });
  }
  return template(consoleUrl.replace(/\/$/, ''));
}

export interface AddChannelInput {
  address: string;
  displayName?: string | null;
  /** Only an address whose owner asked for it. Verification is a separate step. */
  verified?: boolean;
}

export async function addChannel(
  tx: TenantTransaction,
  input: AddChannelInput,
): Promise<string> {
  const { rows } = await tx
    .query<{ id: string }>(
      `INSERT INTO notification_channels (tenant_id, kind, address, display_name, verified_at)
       VALUES ($1, 'EMAIL', $2, $3, CASE WHEN $4 THEN now() ELSE NULL END)
       RETURNING id`,
      [tx.tenantId, input.address.trim(), input.displayName ?? null, input.verified ?? false],
    )
    .catch((error: unknown) => {
      if ((error as { code?: string }).code === '23505') {
        throw new NxError('NX-4091', { detail: 'that address is already a channel here' });
      }
      throw error;
    });

  const id = rows[0]?.id;
  if (!id) {
    throw new NxError('NX-5001', { detail: 'channel insert returned no id' });
  }
  return id;
}

export async function verifyChannel(tx: TenantTransaction, channelId: string): Promise<void> {
  await tx.query(
    `UPDATE notification_channels SET verified_at = now()
     WHERE tenant_id = $1 AND id = $2 AND verified_at IS NULL`,
    [tx.tenantId, channelId],
  );
}

export async function listChannels(tx: TenantTransaction): Promise<NotificationChannel[]> {
  const { rows } = await tx.query<{
    id: string;
    kind: 'EMAIL';
    address: string;
    display_name: string | null;
    verified_at: Date | null;
    status: 'active' | 'disabled';
  }>(
    `SELECT id, kind, address, display_name, verified_at, status
     FROM notification_channels WHERE tenant_id = $1 ORDER BY created_at`,
    [tx.tenantId],
  );

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    address: row.address,
    displayName: row.display_name,
    verified: row.verified_at !== null,
    status: row.status,
  }));
}

export interface SubscribeInput {
  channelId: string;
  eventType: WebhookEventType;
  minSeverity?: NotificationSeverity;
}

export async function subscribe(tx: TenantTransaction, input: SubscribeInput): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO notification_rules (tenant_id, channel_id, event_type, min_severity)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, channel_id, event_type) DO UPDATE
       SET min_severity = EXCLUDED.min_severity, status = 'active'
     RETURNING id`,
    [tx.tenantId, input.channelId, input.eventType, input.minSeverity ?? 'INFO'],
  );

  const id = rows[0]?.id;
  if (!id) {
    throw new NxError('NX-5001', { detail: 'rule insert returned no id' });
  }
  return id;
}

export async function unsubscribe(tx: TenantTransaction, ruleId: string): Promise<void> {
  await tx.query(
    `UPDATE notification_rules SET status = 'disabled' WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, ruleId],
  );
}

export interface QueueNotificationsInput {
  eventType: WebhookEventType;
  /** Where the recipient goes to see the thing this is about. */
  consoleUrl?: string;
}

/**
 * Queues one message per subscribed address.
 *
 * Nothing is queued for an address that has not been proved. A rule pointing at a
 * stranger's inbox would otherwise make this platform a way to send that stranger mail,
 * and the stranger would be right to call it what it is.
 */
export async function queueNotifications(
  tx: TenantTransaction,
  input: QueueNotificationsInput,
): Promise<string[]> {
  const message = renderMessage(input.eventType, input.consoleUrl ?? consoleUrlFromEnv());

  const { rows } = await tx.query<{ id: string; channel_id: string; min_severity: NotificationSeverity }>(
    `SELECT r.id, r.channel_id, r.min_severity
     FROM notification_rules r
     JOIN notification_channels c ON c.tenant_id = r.tenant_id AND c.id = r.channel_id
     WHERE r.tenant_id = $1 AND r.event_type = $2 AND r.status = 'active'
       AND c.status = 'active' AND c.verified_at IS NOT NULL`,
    [tx.tenantId, input.eventType],
  );

  const queued: string[] = [];
  for (const rule of rows) {
    // A rule set to warnings only does not want to hear that a verification completed.
    if (SEVERITY_ORDER[message.severity] < SEVERITY_ORDER[rule.min_severity]) {
      continue;
    }

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO notification_deliveries
         (tenant_id, rule_id, channel_id, event_type, severity, subject, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        tx.tenantId,
        rule.id,
        rule.channel_id,
        input.eventType,
        message.severity,
        message.subject,
        message.body,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (id) {
      queued.push(id);
    }
  }

  return queued;
}

export interface PendingNotification {
  id: string;
  address: string;
  displayName: string | null;
  subject: string;
  body: string;
  severity: NotificationSeverity;
  eventType: string;
  attempts: number;
}

export async function claimPendingNotifications(
  tx: TenantTransaction,
  limit = 50,
): Promise<PendingNotification[]> {
  const { rows } = await tx.query<{
    id: string;
    address: string;
    display_name: string | null;
    subject: string;
    body: string;
    severity: NotificationSeverity;
    event_type: string;
    attempts: number;
  }>(
    `SELECT d.id, c.address, c.display_name, d.subject, d.body, d.severity, d.event_type,
            d.attempts
     FROM notification_deliveries d
     JOIN notification_channels c ON c.tenant_id = d.tenant_id AND c.id = d.channel_id
     WHERE d.tenant_id = $1 AND d.status = 'pending' AND d.next_retry_at <= now()
       AND c.status = 'active' AND c.verified_at IS NOT NULL
     ORDER BY d.next_retry_at
     LIMIT $2
     FOR UPDATE OF d SKIP LOCKED`,
    [tx.tenantId, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    address: row.address,
    displayName: row.display_name,
    subject: row.subject,
    body: row.body,
    severity: row.severity,
    eventType: row.event_type,
    attempts: row.attempts,
  }));
}

export async function recordNotificationResult(
  tx: TenantTransaction,
  deliveryId: string,
  result: { ok: boolean; error?: string | undefined },
): Promise<void> {
  if (result.ok) {
    await tx.query(
      `UPDATE notification_deliveries
       SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL
       WHERE tenant_id = $1 AND id = $2`,
      [tx.tenantId, deliveryId],
    );
    return;
  }

  const { rows } = await tx.query<{ attempts: number }>(
    `SELECT attempts FROM notification_deliveries WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, deliveryId],
  );
  const attempts = (rows[0]?.attempts ?? 0) + 1;
  const retryAt = nextRetryAt(attempts);

  await tx.query(
    `UPDATE notification_deliveries
     SET attempts = $3, last_error = $4, next_retry_at = coalesce($5, next_retry_at),
         status = CASE WHEN $5::timestamptz IS NULL THEN 'abandoned' ELSE 'pending' END
     WHERE tenant_id = $1 AND id = $2`,
    // The reason a mail server refused is operational, and it is written down. It is also
    // the one place an address could reappear in a log, so it is truncated and kept short.
    [tx.tenantId, deliveryId, attempts, result.error?.slice(0, 200) ?? null, retryAt],
  );
}

function consoleUrlFromEnv(): string {
  return process.env['NX_CONSOLE_URL'] ?? 'https://console.nx.sa';
}
