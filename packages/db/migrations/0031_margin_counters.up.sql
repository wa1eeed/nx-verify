-- 0031: what a run cost us and what it earned, in a form the operator may read.
--
-- The operator panel needs one number the platform could not produce: gross margin per
-- customer and per service. Provider cost and billed amount are on the run, and the run is
-- subscriber data that nx_operator must never reach (guard 02). Reading it there would
-- mean giving an internal role a policy on a table holding entities and decisions, which
-- is the exact thing that guard exists to refuse.
--
-- ADR-062 deferred this and said billing would be built from exported summaries. This is
-- that summary, written as it happens: one row per subscriber per month per product,
-- carrying a count and two sums and nothing else. No entity, no identifier, no decision,
-- no reference. It answers "what did we earn on this service for this customer" and
-- cannot answer anything about whom they verified.
--
-- Rule 2 asks for exactly this shape: statistics come from aggregated counters and never
-- from raw data.

SET LOCAL ROLE nx_migrator;

CREATE TABLE margin_counters (
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  period_start          date NOT NULL,
  product_code          text NOT NULL REFERENCES products(code),
  runs                  int NOT NULL DEFAULT 0 CHECK (runs >= 0),
  -- What the subscriber was charged, excluding VAT like every price here.
  billed_halalas        bigint NOT NULL DEFAULT 0 CHECK (billed_halalas >= 0),
  -- What the providers charged us for the same work, when they say.
  provider_cost_halalas bigint NOT NULL DEFAULT 0 CHECK (provider_cost_halalas >= 0),
  -- Runs the package covered. They earn no money this month and cost us all of it, which
  -- is a fact a margin report has to show rather than hide.
  package_runs          int NOT NULL DEFAULT 0 CHECK (package_runs >= 0),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, period_start, product_code)
);

ALTER TABLE margin_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE margin_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON margin_counters
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON margin_counters TO nx_app;

-- The operator reads it and never writes it: a margin figure that the panel showing it
-- can also edit is a figure nobody should trust.
GRANT SELECT ON margin_counters TO nx_operator;
CREATE POLICY operator_read ON margin_counters
  FOR SELECT
  TO nx_operator
  USING (true);
