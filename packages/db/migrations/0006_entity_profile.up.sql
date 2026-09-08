-- 0006: the profile is a computed projection, not a table.
--
-- Concept 3 in docs/00-START-HERE.md: the latest valid attestation per field_path.
-- Rule 9 applies, so this starts as an ordinary view. It becomes materialised only when
-- a measurement says it must.
--
-- security_invoker is the point of this migration. A view runs with its owner's
-- privileges by default, and the owner here is nx_migrator, which owns every table.
-- Without security_invoker the view would read straight past every row level security
-- policy and hand one tenant another tenant's rows. Guard 02 enumerates views and fails
-- if any of them is missing it.

SET LOCAL ROLE nx_migrator;

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
