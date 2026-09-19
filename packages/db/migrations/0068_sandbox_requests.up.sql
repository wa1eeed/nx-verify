-- 0068: the subscriber asking for a sandbox, and us making one.
--
-- A sandbox is a workspace of its own (0027, ADR-068), and that decision has a consequence
-- nobody paid for until now: a workspace cannot make itself one. The grant in 0027 is
-- deliberately `UPDATE (sandbox_of) ON tenants TO nx_operator` and nothing to nx_app, because
-- a workspace that can declare itself a sandbox can declare itself a sandbox after the fact
-- and reclassify a year of real verifications as tests.
--
-- So the only way a subscriber could get one was for somebody on our side to run
-- `pnpm provision sandbox:create`. The screen headed «بيئة الاختبار» offered a link to the
-- support page and called it asking. That link is the whole of what a customer had.
--
-- This table is the ask, and the answer to it. It is not a message and not a ticket: it
-- carries no text anybody typed (rule 6), only who asked, when, what was decided, and, when
-- a sandbox was made, its workspace name. That last column looks like duplication and is
-- not: the subscriber's own connection can read exactly one row of `tenants`, its own, so
-- without a copy here the person who asked for a sandbox cannot be told its name.

SET LOCAL ROLE nx_migrator;

CREATE TABLE sandbox_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  status        text NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED', 'CREATED', 'REFUSED')),
  requested_by  uuid REFERENCES users(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  -- Our own staff, as a string rather than a foreign key: they are not users of this
  -- workspace and must never become rows in its tables.
  decided_by    text,
  decided_at    timestamptz,
  -- The workspace that was made, and its name. Written by the operator, read by everybody.
  sandbox_tenant_id uuid REFERENCES tenants(id),
  sandbox_slug  text,
  -- Why not, from a fixed list. A free text reason would be a field somebody types, which
  -- rule 6 does not allow outside review_cases.decision_note, and a reason nobody can
  -- translate is worse on an Arabic screen than a reason with two possible values.
  refusal_code  text CHECK (refusal_code IS NULL OR refusal_code IN ('HAS_SANDBOX', 'NOT_ELIGIBLE')),

  CONSTRAINT ck_sandbox_request_decided CHECK (
    status = 'REQUESTED' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  -- A request that says a sandbox was made must name it, or the screen that reads this row
  -- tells the subscriber they have a workspace it cannot name.
  CONSTRAINT ck_sandbox_request_created CHECK (
    status <> 'CREATED' OR (sandbox_tenant_id IS NOT NULL AND sandbox_slug IS NOT NULL)
  ),
  CONSTRAINT ck_sandbox_request_refused CHECK (
    status <> 'REFUSED' OR refusal_code IS NOT NULL
  )
);

-- One open ask per workspace. Pressing the button twice is one request, not two, and staff
-- reconciling the queue never see the same customer twice for the same thing.
CREATE UNIQUE INDEX uq_sandbox_request_open ON sandbox_requests (tenant_id)
  WHERE status = 'REQUESTED';
-- And one sandbox per workspace, said here as well as on tenants, so a second CREATED row
-- cannot exist to tell the subscriber a second story.
CREATE UNIQUE INDEX uq_sandbox_request_created ON sandbox_requests (tenant_id)
  WHERE status = 'CREATED';
CREATE INDEX ix_sandbox_request_pending ON sandbox_requests (requested_at)
  WHERE status = 'REQUESTED';

ALTER TABLE sandbox_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON sandbox_requests
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

REVOKE ALL ON sandbox_requests FROM PUBLIC;
-- The subscriber asks and reads the answer, and changes nothing else about the row. No
-- UPDATE: the decision is the platform's, and a workspace that could set its own request to
-- CREATED would be declaring itself to have a sandbox, which is the thing 0027 refuses.
GRANT SELECT, INSERT ON sandbox_requests TO nx_app;
GRANT SELECT ON sandbox_requests TO nx_retention;

-- Staff see every open ask, and answer it. Nothing in this table says anything about whom a
-- subscriber verified, so it is within what rule 2 allows the operator to cross for.
CREATE POLICY operator_manage ON sandbox_requests
  TO nx_operator
  USING (true)
  WITH CHECK (true);
GRANT SELECT, UPDATE ON sandbox_requests TO nx_operator;
