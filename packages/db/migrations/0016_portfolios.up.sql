-- 0016: portfolios, and the third level of every policy.
--
-- docs/01-blueprint.md section 5.3 calls this the most important organising layer, and
-- the reason is in one sentence: policy belongs to the portfolio, not to the system. The
-- rules for onboarding merchants are not the rules for payout beneficiaries, and a
-- platform with one global setting forces a customer to pick the stricter of the two and
-- pay for it everywhere.
--
-- ADR-007 promised three levels for retention: system, tenant, portfolio. Two were built
-- in unit 2 and the third is here.
--
-- An entity may sit in several portfolios, and their policies can disagree. The shortest
-- retention wins (ADR-035). If any portfolio says this must be re-checked weekly, then it
-- must be, and resolving a conflict in the lenient direction would silently weaken the
-- stricter policy that someone deliberately set.

SET LOCAL ROLE nx_migrator;

CREATE TABLE portfolios (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  code                 text NOT NULL,
  name_ar              text NOT NULL,
  name_en              text NOT NULL,
  default_product_code text REFERENCES products(code),
  decision_ruleset     uuid REFERENCES decision_rulesets(id),
  -- Monitoring for members. Still never silent: adding an entity to such a portfolio is
  -- the explicit act, and the monitor it creates records who performed it.
  monitor_by_default   boolean NOT NULL DEFAULT false,
  monitor_cadence      text CHECK (
    monitor_cadence IS NULL OR monitor_cadence IN ('DAILY', 'WEEKLY', 'MONTHLY', 'ON_EXPIRY')
  ),
  monitor_budget_sar   numeric(10,2),
  /** Alert when a new entity enters this view. A saved view is a piece of work. */
  alert_on_enter       boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_portfolio_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_portfolio_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT ck_portfolio_monitoring CHECK (
    monitor_by_default = false
    OR (monitor_cadence IS NOT NULL AND monitor_budget_sar IS NOT NULL AND monitor_budget_sar > 0)
  )
);

ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON portfolios
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON portfolios TO nx_app;
GRANT SELECT ON portfolios TO nx_retention;

CREATE TABLE portfolio_members (
  tenant_id    uuid NOT NULL,
  portfolio_id uuid NOT NULL,
  entity_id    uuid NOT NULL,
  added_by     text NOT NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, portfolio_id, entity_id),
  CONSTRAINT fk_member_portfolio FOREIGN KEY (tenant_id, portfolio_id) REFERENCES portfolios (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_member_entity FOREIGN KEY (tenant_id, entity_id) REFERENCES entities (tenant_id, id)
);

CREATE INDEX ix_member_entity ON portfolio_members (tenant_id, entity_id);

ALTER TABLE portfolio_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_members FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON portfolio_members
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, DELETE ON portfolio_members TO nx_app;
GRANT SELECT ON portfolio_members TO nx_retention;

-- The third level of the retention policy.
ALTER TABLE freshness_policy ADD COLUMN portfolio_id uuid;
ALTER TABLE freshness_policy
  ADD CONSTRAINT fk_freshness_portfolio
  FOREIGN KEY (tenant_id, portfolio_id) REFERENCES portfolios (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE freshness_policy
  ADD CONSTRAINT ck_freshness_portfolio_has_tenant
  CHECK (portfolio_id IS NULL OR tenant_id IS NOT NULL);

DROP INDEX IF EXISTS uq_freshness_policy;
CREATE UNIQUE INDEX uq_freshness_policy
  ON freshness_policy (
    (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (COALESCE(portfolio_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    field_path
  );

DROP VIEW IF EXISTS entity_profile;

CREATE VIEW entity_profile WITH (security_invoker = true) AS
SELECT DISTINCT ON (a.tenant_id, a.entity_id, a.field_path)
  a.tenant_id,
  a.entity_id,
  a.field_path,
  a.value,
  a.authority,
  a.observed_at,
  a.confidence,
  a.id AS attestation_id,
  policy.ttl_days,
  policy.weight,
  COALESCE(a.valid_until, a.observed_at + make_interval(days => policy.ttl_days)) AS effective_until,
  app.freshness_state(
    COALESCE(a.valid_until, a.observed_at + make_interval(days => policy.ttl_days)),
    policy.ttl_days
  ) AS freshness
FROM attestations a
LEFT JOIN LATERAL (
  SELECT p.ttl_days, p.weight
  FROM freshness_policy p
  WHERE (a.field_path = p.field_path OR a.field_path LIKE p.field_path || '.%')
    AND (
      -- A portfolio row applies only to entities that belong to that portfolio.
      (p.portfolio_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM portfolio_members m
         WHERE m.tenant_id = a.tenant_id
           AND m.entity_id = a.entity_id
           AND m.portfolio_id = p.portfolio_id
       ))
      OR (p.portfolio_id IS NULL AND (p.tenant_id = a.tenant_id OR p.tenant_id IS NULL))
    )
  -- Three kinds of specificity, in order: a portfolio beats a tenant setting, a tenant
  -- setting beats the system default, a longer field path beats a shorter one, and among
  -- portfolios the shortest retention wins.
  ORDER BY
    (p.portfolio_id IS NOT NULL) DESC,
    p.tenant_id NULLS LAST,
    length(p.field_path) DESC,
    p.ttl_days ASC
  LIMIT 1
) policy ON true
WHERE a.superseded_by IS NULL
ORDER BY a.tenant_id, a.entity_id, a.field_path, a.observed_at DESC;

COMMENT ON VIEW entity_profile IS
  'Latest live attestation per field, aged against the TTL in force now. Rule 5: source is absent by design.';

GRANT SELECT ON entity_profile TO nx_app;
