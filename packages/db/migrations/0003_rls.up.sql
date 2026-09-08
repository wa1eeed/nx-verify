-- 0003: tenant isolation.
--
-- Rule 3: two layers, not one. A WHERE clause in application code is the first layer.
-- Row level security is the second, and it is the one that holds when the first is
-- forgotten.
--
-- FORCE ROW LEVEL SECURITY is not optional here. Without it the table owner bypasses
-- every policy, and an isolation test connected as the owner would pass while proving
-- nothing (rule 12).
--
-- Failure is closed. current_setting with missing_ok returns NULL when app.tenant_id was
-- never set, the comparison evaluates to NULL, and no row is visible or writable. An
-- unset context yields zero rows, never all rows.

SET LOCAL ROLE nx_migrator;

CREATE FUNCTION app.current_tenant() RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog
AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION app.current_tenant() IS
  'Tenant in scope for the current transaction. NULL when unset, which denies everything.';

GRANT EXECUTE ON FUNCTION app.current_tenant() TO nx_app, nx_retention;

-- tenants is tenant scoped through its own primary key.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON tenants
  USING (id = app.current_tenant())
  WITH CHECK (id = app.current_tenant());

ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON entities
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE attestations FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON attestations
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- Baseline privileges. Migration 0004 narrows what the application role may do to
-- attestations. No role receives DELETE on any table here.
GRANT SELECT, INSERT, UPDATE ON tenants TO nx_app;
GRANT SELECT, INSERT, UPDATE ON entities TO nx_app;
GRANT SELECT, INSERT, UPDATE ON attestations TO nx_app;

GRANT SELECT ON tenants, entities, attestations TO nx_retention;
