SET LOCAL ROLE nx_migrator;

DROP VIEW IF EXISTS entity_profile;

ALTER TABLE freshness_policy DROP CONSTRAINT IF EXISTS fk_freshness_portfolio;
ALTER TABLE freshness_policy DROP CONSTRAINT IF EXISTS ck_freshness_portfolio_has_tenant;
ALTER TABLE freshness_policy DROP COLUMN IF EXISTS portfolio_id;

DROP INDEX IF EXISTS uq_freshness_policy;
CREATE UNIQUE INDEX uq_freshness_policy
  ON freshness_policy (
    (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    field_path
  );

-- Restore the view exactly as migration 0007 left it.
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
    AND (p.tenant_id = a.tenant_id OR p.tenant_id IS NULL)
  ORDER BY p.tenant_id NULLS LAST, length(p.field_path) DESC
  LIMIT 1
) policy ON true
WHERE a.superseded_by IS NULL
ORDER BY a.tenant_id, a.entity_id, a.field_path, a.observed_at DESC;

COMMENT ON VIEW entity_profile IS
  'Latest live attestation per field, aged against the TTL in force now. Rule 5: source is absent by design.';

GRANT SELECT ON entity_profile TO nx_app;

REVOKE ALL ON portfolio_members FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON portfolio_members;
DROP TABLE IF EXISTS portfolio_members;

REVOKE ALL ON portfolios FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON portfolios;
DROP TABLE IF EXISTS portfolios;
