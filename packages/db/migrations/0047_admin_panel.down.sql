SET LOCAL ROLE nx_migrator;

-- The profile view exactly as migration 0016 left it.
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

REVOKE SELECT ON cost_book FROM nx_operator;
REVOKE SELECT, INSERT, UPDATE ON price_book FROM nx_operator;
DROP POLICY IF EXISTS operator_default_prices_panel ON price_book;

UPDATE products SET status = 'active' WHERE status = 'suspended';
ALTER TABLE products DROP CONSTRAINT products_status_check;
ALTER TABLE products ADD CONSTRAINT products_status_check CHECK (status IN ('active', 'retired'));

DROP TABLE IF EXISTS tenant_price_discounts;

ALTER TABLE verification_runs DROP CONSTRAINT verification_runs_charge_source_check;
ALTER TABLE verification_runs ADD CONSTRAINT verification_runs_charge_source_check
  CHECK (charge_source IN ('PACKAGE', 'WALLET', 'FREE'));

DROP TABLE IF EXISTS bundle_grants;
ALTER TABLE topup_requests DROP COLUMN IF EXISTS bundle_code;
DROP TABLE IF EXISTS credit_bundles;

DROP TABLE IF EXISTS section_requirements;
DROP TABLE IF EXISTS platform_settings;
DROP TABLE IF EXISTS operator_accounts;
