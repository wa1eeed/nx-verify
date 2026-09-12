SET LOCAL ROLE nx_migrator;

REVOKE ALL ON run_waits FROM nx_app, nx_retention;
DROP TABLE IF EXISTS run_waits;

DROP INDEX IF EXISTS ix_inbound_correlation;
ALTER TABLE inbound_events DROP COLUMN IF EXISTS correlation_digest;

ALTER TABLE run_steps
  DROP CONSTRAINT IF EXISTS ck_awaiting_not_billed,
  DROP CONSTRAINT run_steps_status_check,
  ADD CONSTRAINT run_steps_status_check CHECK (
    status IN ('OK', 'NOT_FOUND', 'ERROR', 'SKIPPED', 'CACHED')
  );

ALTER TABLE verification_runs
  DROP CONSTRAINT verification_runs_status_check,
  ADD CONSTRAINT verification_runs_status_check CHECK (
    status IN ('PENDING', 'OK', 'PARTIAL', 'NOT_FOUND', 'ERROR')
  );
