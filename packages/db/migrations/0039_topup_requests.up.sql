-- 0039: the subscriber asking to put money in, and us confirming it arrived.
--
-- Until now a balance could only be topped up by a command we ran, against a tax invoice
-- issued somewhere outside this platform entirely. That works for the first customer and
-- for nobody after them: the subscriber cannot see what they asked for, cannot see
-- whether it was received, and has nothing to quote when they ring up about it.
--
-- This is a bank transfer flow and not a card one, because that is how business to
-- business money moves here. It needs no payment gateway and no external account, which
-- is also why it could be built at all.
--
-- Two properties the table exists to enforce. A request carries its own reference, so the
-- subscriber puts something in the transfer that we can match. And a request is credited
-- exactly once: the confirmation is a conditional update on the status, so two operators
-- pressing confirm at the same moment produce one credit and one refusal, rather than two
-- credits and a reconciliation.

SET LOCAL ROLE nx_migrator;

CREATE TABLE topup_counters (
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  year       int NOT NULL,
  next_value int NOT NULL DEFAULT 1 CHECK (next_value > 0),
  PRIMARY KEY (tenant_id, year)
);

ALTER TABLE topup_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE topup_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON topup_counters
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

REVOKE ALL ON topup_counters FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON topup_counters TO nx_app;

CREATE TABLE topup_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  -- What a person quotes on the phone and writes in the transfer.
  reference     text NOT NULL,
  -- Excluding VAT, like every other price in this platform. VAT is added at presentation
  -- and falls due on the top up, which is why the invoice belongs on this row.
  amount        numeric(12,2) NOT NULL CHECK (amount > 0),
  status        text NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED', 'CONFIRMED', 'REJECTED')),
  requested_by  uuid REFERENCES users(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  -- Our own staff, as a string rather than a foreign key: they are not users of this
  -- workspace and must never become rows in its tables.
  settled_by    text,
  settled_at    timestamptz,
  vat_invoice_id text,
  note          text,
  CONSTRAINT uq_topup_reference UNIQUE (tenant_id, reference),
  -- A confirmed top up without its tax invoice is an accounting problem waiting to be
  -- found at the year end, so the row cannot be in that state at all.
  CONSTRAINT ck_topup_settled CHECK (
    status <> 'CONFIRMED' OR (vat_invoice_id IS NOT NULL AND settled_at IS NOT NULL)
  )
);

CREATE INDEX ix_topup_open ON topup_requests (tenant_id, requested_at DESC);
CREATE INDEX ix_topup_pending ON topup_requests (status) WHERE status = 'REQUESTED';

ALTER TABLE topup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE topup_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON topup_requests
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

REVOKE ALL ON topup_requests FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON topup_requests TO nx_app;
GRANT SELECT ON topup_requests TO nx_retention;

-- What the subscriber bought, in money, and nothing about whom they verified. Staff who
-- cannot see a pending transfer end up asking the customer to read their own bank
-- statement aloud.
CREATE POLICY operator_read ON topup_requests
  FOR SELECT
  TO nx_operator
  USING (true);
GRANT SELECT ON topup_requests TO nx_operator;
