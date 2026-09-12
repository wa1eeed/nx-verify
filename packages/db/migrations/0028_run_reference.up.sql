-- 0028: a number a person can read out loud, and where a run was paid from.
--
-- Two things a customer asks for that the platform could not answer.
--
-- The first is a reference. Every run has a uuid, which is correct and unusable: nobody
-- reads one over the phone, and support conversations are held over the phone. So a run
-- also gets VRF-2026-000019, allocated per subscriber rather than globally, because a
-- global counter tells every customer how many verifications this platform performs.
--
-- The second is where the money came from. A package sells capacity, and a wallet holds
-- credit, and until now every run drew on the wallet regardless. That makes the package a
-- limit rather than a purchase: a customer who bought three thousand verifications was
-- paying for them twice. From here a run inside the capacity draws on the package and
-- moves no money, a run past it draws on the wallet, and the run says which.

SET LOCAL ROLE nx_migrator;

ALTER TABLE verification_runs
  ADD COLUMN reference text,
  ADD COLUMN charge_source text NOT NULL DEFAULT 'WALLET'
    CHECK (charge_source IN ('PACKAGE', 'WALLET', 'FREE'));

-- Unique inside the subscriber, which is the only place it is ever shown.
CREATE UNIQUE INDEX uq_run_reference ON verification_runs (tenant_id, reference)
  WHERE reference IS NOT NULL;

/**
 * The per subscriber counter.
 *
 * One row per subscriber per year. Allocating a number locks that row until the
 * transaction commits, so a subscriber's concurrent verifications serialise on their tail.
 * At the volumes in docs/01-blueprint.md, thousands of runs a year, that is nothing, and
 * rule 9 says no optimisation before measurement. If measurement ever demands it, the fix
 * is to hand out blocks of numbers rather than one at a time, and nothing above this
 * table changes.
 */
CREATE TABLE run_counters (
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  year       int NOT NULL,
  next_value int NOT NULL DEFAULT 1 CHECK (next_value > 0),
  PRIMARY KEY (tenant_id, year)
);

ALTER TABLE run_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON run_counters
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON run_counters TO nx_app;
