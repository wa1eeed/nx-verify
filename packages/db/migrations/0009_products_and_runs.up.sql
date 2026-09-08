-- 0009: products are data, and a run is the record of executing one.
--
-- Rule 8 and ADR-003: adding a verification product is rows in these tables, never a
-- deployment. That is the whole point of the design, and docs/README.md sets the test:
-- after unit 4, add a new product with database rows only and no code.
--
-- The catalog carries no tenant_id. A product definition is not tenant data, it is the
-- shape of a service. Which tenant may buy it, and at what price, lives in price_book in
-- unit 6. Guard 02 enumerates tables that carry tenant_id, so these are correctly outside
-- its scope while verification_runs and run_steps are inside it.

SET LOCAL ROLE nx_migrator;

CREATE TABLE products (
  code             text PRIMARY KEY,
  name_ar          text NOT NULL,
  name_en          text NOT NULL,
  subject_type     text NOT NULL CHECK (
    subject_type IN ('BUSINESS', 'PERSON', 'FREELANCER', 'BANK_ACCOUNT', 'PROPERTY')
  ),
  -- JSON Schema, validated before any provider is called, so a malformed request costs
  -- the customer nothing.
  input_schema     jsonb NOT NULL,
  is_composite     boolean NOT NULL DEFAULT false,
  partial_policy   text NOT NULL DEFAULT 'BEST_EFFORT'
    CHECK (partial_policy IN ('ALL_OR_NOTHING', 'BEST_EFFORT')),
  decision_ruleset uuid,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  valid_from       timestamptz NOT NULL DEFAULT now(),
  valid_to         timestamptz
);

CREATE TABLE product_steps (
  product_code      text NOT NULL REFERENCES products(code) ON DELETE CASCADE,
  step_key          text NOT NULL,
  seq               int  NOT NULL,
  provider          text NOT NULL,
  endpoint          text NOT NULL,
  -- How the provider request is built. Only three reference forms are legal:
  -- $.subject.*, $.steps.<step_key>.*, and literal:<value>.
  input_binding     jsonb NOT NULL,
  depends_on        text[] NOT NULL DEFAULT '{}',
  required          boolean NOT NULL DEFAULT true,
  fallback_provider text,
  -- Per step, not per product. In a composite check the address may be served from cache
  -- while the registry status is always called live.
  cache_ttl_days    int,
  -- Used to apportion the product price when only some steps succeed. The price of a
  -- composite product is not the sum of its steps.
  step_weight       int NOT NULL DEFAULT 1,
  PRIMARY KEY (product_code, step_key),
  CONSTRAINT ck_step_weight CHECK (step_weight > 0),
  CONSTRAINT ck_step_cache_ttl CHECK (cache_ttl_days IS NULL OR cache_ttl_days >= 0),
  CONSTRAINT ck_step_not_self_dependent CHECK (NOT (step_key = ANY (depends_on)))
);

CREATE INDEX ix_product_steps_seq ON product_steps (product_code, seq);

GRANT SELECT, INSERT, UPDATE, DELETE ON products, product_steps TO nx_app;
GRANT SELECT ON products, product_steps TO nx_retention;

CREATE TABLE verification_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  product_code      text NOT NULL REFERENCES products(code),
  entity_id         uuid,
  client_ref        text,
  idempotency_key   text,
  -- Frozen at execution. Upgrading a customer mid month must not re-price the past.
  mode_at_execution text NOT NULL CHECK (mode_at_execution IN ('MANAGED', 'BYOC')),
  provider_used     text,
  status            text NOT NULL CHECK (
    status IN ('PENDING', 'OK', 'PARTIAL', 'NOT_FOUND', 'ERROR')
  ),
  decision          text CHECK (decision IN ('PASS', 'FAIL', 'REVIEW')),
  decision_reasons  jsonb,
  latency_ms        int,
  billable          boolean NOT NULL DEFAULT true,
  billed_amount     numeric(10,2),
  provider_cost     numeric(10,2),
  triggered_by      text NOT NULL CHECK (triggered_by IN ('API', 'CONSOLE', 'MONITOR', 'BULK')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_runs_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_runs_entity FOREIGN KEY (tenant_id, entity_id) REFERENCES entities (tenant_id, id)
);

-- Rule 7. One network hiccup must not become two queries and two charges.
CREATE UNIQUE INDEX uq_idem
  ON verification_runs (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX ix_runs_recent ON verification_runs (tenant_id, created_at DESC);

CREATE TABLE run_steps (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  run_id            uuid NOT NULL,
  step_key          text NOT NULL,
  provider          text NOT NULL,
  endpoint          text NOT NULL,
  status            text NOT NULL CHECK (
    status IN ('OK', 'NOT_FOUND', 'ERROR', 'SKIPPED', 'CACHED')
  ),
  served_from_cache boolean NOT NULL DEFAULT false,
  latency_ms        int,
  billable          boolean NOT NULL DEFAULT true,
  billed_amount     numeric(10,2),
  provider_cost     numeric(10,2),
  error_code        text,
  skipped_because   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_run_steps_run FOREIGN KEY (tenant_id, run_id) REFERENCES verification_runs (tenant_id, id),
  CONSTRAINT uq_run_steps UNIQUE (tenant_id, run_id, step_key),
  -- Guard 04 in constraint form. Charging for a step that never ran is the fastest route
  -- to a billing dispute with an enterprise customer.
  CONSTRAINT ck_skipped_not_billed CHECK (
    status <> 'SKIPPED' OR (billable = false AND COALESCE(billed_amount, 0) = 0)
  ),
  CONSTRAINT ck_error_not_billed CHECK (
    status <> 'ERROR' OR (billable = false AND COALESCE(billed_amount, 0) = 0)
  )
);

CREATE INDEX ix_step_run ON run_steps (tenant_id, run_id);

ALTER TABLE verification_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON verification_runs
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON run_steps
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON verification_runs TO nx_app;
GRANT SELECT, INSERT, UPDATE ON run_steps TO nx_app;
GRANT SELECT ON verification_runs, run_steps TO nx_retention;
