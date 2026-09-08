SET LOCAL ROLE nx_migrator;

DROP VIEW IF EXISTS entity_profile;

-- Restore the view exactly as migration 0006 created it.
CREATE VIEW entity_profile WITH (security_invoker = true) AS
SELECT DISTINCT ON (a.tenant_id, a.entity_id, a.field_path)
  a.tenant_id,
  a.entity_id,
  a.field_path,
  a.value,
  a.authority,
  a.observed_at,
  a.valid_until,
  a.confidence,
  a.id AS attestation_id,
  CASE
    WHEN a.valid_until IS NULL THEN 'permanent'
    WHEN a.valid_until <= now() THEN 'expired'
    WHEN a.valid_until <= now() + interval '14 days' THEN 'expiring'
    ELSE 'fresh'
  END AS freshness
FROM attestations a
WHERE a.superseded_by IS NULL
ORDER BY a.tenant_id, a.entity_id, a.field_path, a.observed_at DESC;

COMMENT ON VIEW entity_profile IS
  'Latest live attestation per field. Rule 5: source is deliberately absent, authority is what callers see.';

GRANT SELECT ON entity_profile TO nx_app;

DROP FUNCTION IF EXISTS app.freshness_state(timestamptz, int);

REVOKE ALL ON freshness_policy FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON freshness_policy;
DROP TABLE IF EXISTS freshness_policy;
