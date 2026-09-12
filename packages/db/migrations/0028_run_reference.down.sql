SET LOCAL ROLE nx_migrator;

DROP POLICY IF EXISTS t_isolation ON run_counters;
REVOKE ALL ON run_counters FROM nx_app;
DROP TABLE IF EXISTS run_counters;

DROP INDEX IF EXISTS uq_run_reference;

ALTER TABLE verification_runs
  DROP COLUMN charge_source,
  DROP COLUMN reference;
