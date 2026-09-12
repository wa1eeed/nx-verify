-- 0037: a run that is waiting for the provider to call back.
--
-- Unit 60 gave a provider somewhere to call. Nothing acted on what arrived, so a service
-- whose answer comes later still could not be sold: the call landed, was written down,
-- and stopped there.
--
-- The state that was missing is a run that has asked and not yet been answered. It is not
-- an error, because nothing failed, and not a partial success, because nothing has been
-- decided. It is AWAITING, and the one thing that must be true of it is that it has not
-- settled: no hold is kept, no charge is made, no usage is counted. A customer must not
-- pay twice because the answer came in two parts, and paying at the end is how that is
-- guaranteed rather than promised.
--
-- What identifies the thing being waited on is stored as a digest and never as a value.
-- The provider's handle for an entity is theirs, not ours, and a column holding it would
-- be one more place a support query can read something that belongs to a customer.

SET LOCAL ROLE nx_migrator;

ALTER TABLE verification_runs
  DROP CONSTRAINT verification_runs_status_check,
  ADD CONSTRAINT verification_runs_status_check CHECK (
    status IN ('PENDING', 'AWAITING', 'OK', 'PARTIAL', 'NOT_FOUND', 'ERROR')
  );

ALTER TABLE run_steps
  DROP CONSTRAINT run_steps_status_check,
  ADD CONSTRAINT run_steps_status_check CHECK (
    status IN ('OK', 'NOT_FOUND', 'ERROR', 'SKIPPED', 'CACHED', 'AWAITING', 'PENDING')
  ),
  -- Guard 04 in the database rather than in the code: work that has not happened is not
  -- billed, and a step we are still waiting on has not happened.
  ADD CONSTRAINT ck_awaiting_not_billed CHECK (
    status NOT IN ('AWAITING', 'PENDING')
    OR (billable = false AND coalesce(billed_amount, 0) = 0)
  );

-- What the event is about, as a digest. Set where the payload names something we could
-- be waiting on, and null otherwise.
ALTER TABLE inbound_events ADD COLUMN correlation_digest text;
CREATE INDEX ix_inbound_correlation ON inbound_events (correlation_digest)
  WHERE correlation_digest IS NOT NULL AND status = 'RECEIVED';

CREATE TABLE run_waits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  run_id         uuid NOT NULL,
  step_key       text NOT NULL,
  provider       text NOT NULL,
  environment    text NOT NULL CHECK (environment IN ('sandbox', 'live')),
  -- sha256 over provider, environment and the provider's handle. Matching is done by
  -- comparing digests, so the handle itself is never stored.
  correlation_digest text NOT NULL,
  -- The subject this run was started with, encrypted with the tenant's key. Resuming
  -- means running the product again, and the product needs its input. Rule 4 allows
  -- encrypted at rest and nothing else, so that is what this is.
  subject_encrypted bytea NOT NULL,
  status         text NOT NULL DEFAULT 'WAITING'
    CHECK (status IN ('WAITING', 'MATCHED', 'RESUMED', 'EXPIRED')),
  -- A wait that never ends is a run that never closes and a customer who never hears.
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  CONSTRAINT uq_run_waits UNIQUE (tenant_id, run_id, step_key),
  CONSTRAINT fk_run_waits_run FOREIGN KEY (tenant_id, run_id)
    REFERENCES verification_runs (tenant_id, id)
);

CREATE INDEX ix_waits_open ON run_waits (tenant_id, correlation_digest)
  WHERE status = 'WAITING';
CREATE INDEX ix_waits_expiry ON run_waits (expires_at) WHERE status = 'WAITING';

ALTER TABLE run_waits ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_waits FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON run_waits
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

REVOKE ALL ON run_waits FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON run_waits TO nx_app;
GRANT SELECT, DELETE ON run_waits TO nx_retention;
