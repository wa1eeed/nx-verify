-- 0023: telling a person, not only a system.
--
-- Webhooks already carry every event to the customer's own systems. That covers the
-- integrator and covers nobody else: the compliance officer who needs to know that a
-- record in their portfolio changed does not read a webhook, and the finance person who
-- needs to know the balance is low does not either.
--
-- The rule that shapes the tables is that a notification leaves our custody. It arrives
-- in an inbox we do not control, sits in a mail server we have never seen, and is
-- forwarded by people we will never meet. So a message here says that something happened
-- and where to look, and never what was found. No identifier (rule 4), no provider name
-- (rule 5), no field value. The message is a pointer, and the console is the document.
--
-- An address must be proved before anything is sent to it, or a rule pointing at a
-- stranger's inbox turns this platform into a way to send that stranger mail.

SET LOCAL ROLE nx_migrator;

CREATE TABLE notification_channels (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  kind         text NOT NULL DEFAULT 'EMAIL' CHECK (kind IN ('EMAIL')),
  address      text NOT NULL,
  display_name text,
  -- Nothing is sent to an address that has not been proved.
  verified_at  timestamptz,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_channel_tenant_id UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX uq_channel_address ON notification_channels (tenant_id, kind, lower(address));

ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_channels FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON notification_channels
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON notification_channels TO nx_app;

-- Who is told what. One row is one subscription: this address, this event, at or above
-- this severity.
CREATE TABLE notification_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  channel_id   uuid NOT NULL,
  event_type   text NOT NULL,
  min_severity text NOT NULL DEFAULT 'INFO' CHECK (min_severity IN ('INFO', 'WARNING', 'CRITICAL')),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_rule_channel FOREIGN KEY (tenant_id, channel_id)
    REFERENCES notification_channels (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT uq_rule UNIQUE (tenant_id, channel_id, event_type),
  CONSTRAINT uq_rule_tenant_id UNIQUE (tenant_id, id)
);

CREATE INDEX ix_rule_event ON notification_rules (tenant_id, event_type) WHERE status = 'active';

ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON notification_rules
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON notification_rules TO nx_app;

-- What was sent, and what happened to it. Written in the same transaction as the change
-- that caused it, like a webhook delivery, so nothing is announced for work that rolled
-- back and nothing committed goes unannounced.
CREATE TABLE notification_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  rule_id       uuid NOT NULL,
  channel_id    uuid NOT NULL,
  event_type    text NOT NULL,
  severity      text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  -- The rendered message. It is here for the console and for support, so it is written
  -- under the same restraint as the message itself: a pointer, never a payload.
  subject       text NOT NULL,
  body          text NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sent', 'failed', 'abandoned')),
  attempts      int NOT NULL DEFAULT 0,
  last_error    text,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  CONSTRAINT fk_delivery_rule FOREIGN KEY (tenant_id, rule_id)
    REFERENCES notification_rules (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_delivery_channel FOREIGN KEY (tenant_id, channel_id)
    REFERENCES notification_channels (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_notification_pending ON notification_deliveries (tenant_id, next_retry_at)
  WHERE status = 'pending';

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON notification_deliveries
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON notification_deliveries TO nx_app;
GRANT SELECT ON notification_deliveries TO nx_retention;
