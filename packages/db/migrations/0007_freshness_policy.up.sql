-- 0007: freshness is arithmetic, not a call.
--
-- ADR-007. A field ages on its own from observed_at and the TTL in force right now.
-- Nothing is called, no balance is spent, and above all no attestation is rewritten when
-- the TTL changes. Guard 07 proves the last part byte for byte.
--
-- This is why the profile view is rebuilt here. In migration 0006 freshness read the
-- stored valid_until, which would have frozen a field's expiry at the TTL that happened
-- to be in force on the day it was written. Editing the TTL would then have required
-- rewriting attestations, which rule 1 forbids outright.
--
-- valid_until keeps a narrower and more honest job: a real expiry date that came from
-- the authority itself, such as the one printed on a freelance document. When it is set
-- it wins, because a genuine expiry beats an estimate.
--
-- Precedence today is tenant, then system default. docs/00-START-HERE.md concept 4 calls
-- for a portfolio level between them. Portfolios arrive in phase 2, and they slot in as
-- one more row source in the lateral lookup below, with no change to any caller.

SET LOCAL ROLE nx_migrator;

CREATE TABLE freshness_policy (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid,
  field_path  text NOT NULL,
  ttl_days    int  NOT NULL,
  weight      int  NOT NULL DEFAULT 10,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_freshness_ttl CHECK (ttl_days > 0),
  CONSTRAINT ck_freshness_weight CHECK (weight >= 0)
);

-- The schema document expresses this as PRIMARY KEY (COALESCE(tenant_id, ...), field_path),
-- which PostgreSQL will not accept as a primary key because it is an expression. A unique
-- index on the same expression carries the identical guarantee: one row per field per
-- tenant, and one system default row per field.
CREATE UNIQUE INDEX uq_freshness_policy
  ON freshness_policy (
    (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    field_path
  );

-- System defaults, from docs/02-schema.md section 6.
--
-- Seeded before row level security is switched on, because the policy below refuses a
-- row with a NULL tenant_id from anyone, the owner included. That refusal is the point:
-- once this migration finishes, no running code can edit the default that every tenant
-- inherits. A new default is a new migration.
INSERT INTO freshness_policy (tenant_id, field_path, ttl_days, weight) VALUES
  (NULL, 'cr.status',                    7, 20),
  (NULL, 'cr.core',                     90, 26),
  (NULL, 'address.national',            30, 14),
  (NULL, 'manager.signing_authority',   90, 24),
  (NULL, 'iban.ownership',             180, 14),
  (NULL, 'property.deed',              365, 10);
-- freelance.document is deliberately absent. It carries a real expiry date from the
-- authority, so an estimated TTL would be wrong for it and the console does not offer
-- to edit one.

ALTER TABLE freshness_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE freshness_policy FORCE ROW LEVEL SECURITY;

-- A tenant reads the system defaults and its own overrides, and writes only its own.
-- Without the narrower WITH CHECK a tenant could edit the default every other tenant
-- inherits.
CREATE POLICY t_isolation ON freshness_policy
  USING (tenant_id IS NULL OR tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON freshness_policy TO nx_app;
GRANT SELECT ON freshness_policy TO nx_retention;

-- One definition of what the four freshness states mean, used by the view and by the
-- impact preview. Two copies of this CASE expression would drift, and the preview would
-- then promise the operator something different from what the console shows afterwards.
--
-- ADR-012: the warning window scales with the TTL instead of being a flat 14 days as
-- docs/02-schema.md section 5 has it. That flat window predates the move to computed
-- freshness, and it breaks on short lifetimes: cr.status lives 7 days, so a 14 day
-- warning would mark it as expiring the instant it was verified, and a warning that is
-- always on is not a warning. A quarter of the TTL, capped at 14 days, gives a real
-- warning at every lifetime. A field with no TTL keeps the flat 14 days, because its
-- expiry came from the authority and has no lifetime to take a fraction of.
CREATE FUNCTION app.freshness_state(effective_until timestamptz, ttl_days int DEFAULT NULL)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN effective_until IS NULL THEN 'permanent'
    WHEN effective_until <= now() THEN 'expired'
    WHEN effective_until <= now() + CASE
           WHEN ttl_days IS NULL THEN interval '14 days'
           ELSE least(interval '14 days', make_interval(days => ttl_days) * 0.25)
         END THEN 'expiring'
    ELSE 'fresh'
  END;
$$;

GRANT EXECUTE ON FUNCTION app.freshness_state(timestamptz, int) TO nx_app, nx_retention;

-- CREATE OR REPLACE cannot change a view's column list, so the old definition is
-- dropped first. Nothing depends on it yet beyond the profile reader.
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
  -- A real expiry from the authority wins. Otherwise the TTL in force right now applies.
  COALESCE(
    a.valid_until,
    a.observed_at + make_interval(days => policy.ttl_days)
  ) AS effective_until,
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
  -- Two kinds of specificity, in order. A tenant override beats the system default, and
  -- a longer path beats a shorter one, so a policy on cr.core governs cr.core.name and
  -- cr.core.capital without a row having to exist for each of them.
  ORDER BY p.tenant_id NULLS LAST, length(p.field_path) DESC
  LIMIT 1
) policy ON true
WHERE a.superseded_by IS NULL
ORDER BY a.tenant_id, a.entity_id, a.field_path, a.observed_at DESC;

COMMENT ON VIEW entity_profile IS
  'Latest live attestation per field, aged against the TTL in force now. Rule 5: source is absent by design.';

GRANT SELECT ON entity_profile TO nx_app;
