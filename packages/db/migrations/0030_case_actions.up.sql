-- 0030: what happens after the file is decided.
--
-- A verification platform ends at the answer. An onboarding platform does not: an
-- approved merchant has to be activated somewhere, a rejected one has to reach the person
-- who will talk to them, and a file sent to review has to land in front of somebody. That
-- last step is where a customer stops describing us as a data source.
--
-- Two things this deliberately does not build. It does not build a third delivery
-- mechanism: signed webhooks and notifications already exist, with retries, backoff and a
-- worker that drives them, and a third queue would be a third set of failure modes. And
-- it does not invent an integration protocol: an action that reaches a customer's CRM is
-- an HTTP call to an address they gave us, which is what a webhook is.
--
-- What is new is the routing. Endpoints subscribe to event types globally; an onboarding
-- action is chosen per journey and per outcome, so "on approval call our activation
-- endpoint, on rejection tell compliance and nobody else" becomes rows.

SET LOCAL ROLE nx_migrator;

CREATE TABLE case_actions (
  tenant_id    uuid NOT NULL,
  journey_code text NOT NULL,
  action_key   text NOT NULL,
  seq          int NOT NULL DEFAULT 1,
  -- Which outcome fires it. ANY fires on every decided file, which is what an audit sink
  -- or a CRM record usually wants.
  on_outcome   text NOT NULL CHECK (on_outcome IN ('APPROVED', 'REJECTED', 'IN_REVIEW', 'ANY')),
  action_type  text NOT NULL CHECK (action_type IN ('WEBHOOK', 'NOTIFY')),
  -- Exactly one of these, enforced below: a webhook names an endpoint, a notification
  -- names a channel.
  endpoint_id  uuid,
  channel_id   uuid,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, journey_code, action_key),
  CONSTRAINT fk_action_journey FOREIGN KEY (tenant_id, journey_code)
    REFERENCES onboarding_journeys (tenant_id, code) ON DELETE CASCADE,
  CONSTRAINT fk_action_endpoint FOREIGN KEY (tenant_id, endpoint_id)
    REFERENCES webhook_endpoints (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_action_channel FOREIGN KEY (tenant_id, channel_id)
    REFERENCES notification_channels (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT ck_action_target CHECK (
    (action_type = 'WEBHOOK' AND endpoint_id IS NOT NULL AND channel_id IS NULL)
    OR (action_type = 'NOTIFY' AND channel_id IS NOT NULL AND endpoint_id IS NULL)
  )
);

CREATE INDEX ix_case_actions_journey ON case_actions (tenant_id, journey_code)
  WHERE status = 'active';

ALTER TABLE case_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON case_actions
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON case_actions TO nx_app;

-- What a file actually fired, so "why did their CRM never hear about this" is answerable.
CREATE TABLE case_action_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  case_id     uuid NOT NULL,
  action_key  text NOT NULL,
  action_type text NOT NULL,
  outcome     text NOT NULL,
  -- The delivery this became, in whichever queue carries it. Null when nothing was
  -- queued, which happens when the action pointed at something since disabled.
  delivery_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_action_log_case FOREIGN KEY (tenant_id, case_id)
    REFERENCES onboarding_cases (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_action_log_case ON case_action_log (tenant_id, case_id);

ALTER TABLE case_action_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_action_log FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON case_action_log
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT ON case_action_log TO nx_app;
GRANT SELECT ON case_action_log TO nx_retention;

-- A message sent because a file was decided has no subscription behind it.
--
-- The rule column was written when every message came from somebody subscribing to an
-- event type. An onboarding action is the other shape: the action is the reason, and
-- pretending it was a subscription would put a row in notification_rules that nobody
-- asked for and that would then appear on the settings screen as a subscription the
-- customer never made.
ALTER TABLE notification_deliveries ALTER COLUMN rule_id DROP NOT NULL;
