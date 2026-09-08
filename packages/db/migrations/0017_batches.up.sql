-- 0017: smart batches.
--
-- docs/01-blueprint.md section 5.5: a portfolio generates its own batch. "Re-verify
-- everything in the merchant portfolio older than ninety days", with the cost shown
-- before it runs and an explicit confirmation.
--
-- The confirmation records the figure the person was shown. A batch confirmed against an
-- estimate of four hundred riyals must not quietly run at nine hundred because more
-- entities became eligible between the preview and the click. That is the difference
-- between a cost preview and a cost promise, and only the second is worth showing.

SET LOCAL ROLE nx_migrator;

CREATE TABLE batches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  portfolio_id       uuid,
  product_code       text NOT NULL REFERENCES products(code),
  -- What to select. A closed set of criteria, like decision conditions, and for the same
  -- reason: a query stored in a column is a query nobody reviews.
  criteria           jsonb NOT NULL,
  status             text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'CONFIRMED', 'RUNNING', 'DONE', 'CANCELLED')),

  -- What the person was shown, and what they agreed to.
  estimated_entities int NOT NULL,
  estimated_cost     numeric(12,2) NOT NULL,
  confirmed_cost     numeric(12,2),
  actual_cost        numeric(12,2) NOT NULL DEFAULT 0,

  created_by         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  confirmed_by       text,
  confirmed_at       timestamptz,
  completed_at       timestamptz,

  CONSTRAINT uq_batch_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_batch_portfolio FOREIGN KEY (tenant_id, portfolio_id) REFERENCES portfolios (tenant_id, id),
  -- Nothing runs without a name against it and the figure that name agreed to.
  CONSTRAINT ck_batch_confirmation CHECK (
    status IN ('DRAFT', 'CANCELLED')
    OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND confirmed_cost IS NOT NULL)
  ),
  CONSTRAINT ck_batch_estimate CHECK (estimated_entities >= 0 AND estimated_cost >= 0)
);

CREATE INDEX ix_batch_status ON batches (tenant_id, status, created_at DESC);

ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON batches
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON batches TO nx_app;
GRANT SELECT ON batches TO nx_retention;

CREATE TABLE batch_items (
  tenant_id  uuid NOT NULL,
  batch_id   uuid NOT NULL,
  entity_id  uuid NOT NULL,
  status     text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'DONE', 'FAILED', 'SKIPPED')),
  run_id     uuid,
  error_code text,
  cost       numeric(10,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, batch_id, entity_id),
  CONSTRAINT fk_item_batch FOREIGN KEY (tenant_id, batch_id) REFERENCES batches (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_item_entity FOREIGN KEY (tenant_id, entity_id) REFERENCES entities (tenant_id, id),
  CONSTRAINT fk_item_run FOREIGN KEY (tenant_id, run_id) REFERENCES verification_runs (tenant_id, id)
);

CREATE INDEX ix_item_pending ON batch_items (tenant_id, batch_id) WHERE status = 'PENDING';

ALTER TABLE batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_items FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON batch_items
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON batch_items TO nx_app;
GRANT SELECT ON batch_items TO nx_retention;
