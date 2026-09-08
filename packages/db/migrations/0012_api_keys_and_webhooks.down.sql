SET LOCAL ROLE nx_migrator;

REVOKE ALL ON audit_log FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON audit_log;
DROP TABLE IF EXISTS audit_log;
DROP FUNCTION IF EXISTS app.create_audit_partition(date);
DROP FUNCTION IF EXISTS app.prepare_audit_partition(text);

REVOKE ALL ON webhook_deliveries FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON webhook_deliveries;
DROP TABLE IF EXISTS webhook_deliveries;

REVOKE ALL ON webhook_endpoints FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON webhook_endpoints;
DROP TABLE IF EXISTS webhook_endpoints;

DROP FUNCTION IF EXISTS app.resolve_api_key(bytea);
REVOKE ALL ON api_keys FROM nx_app, nx_retention, nx_auth;
DROP POLICY IF EXISTS auth_lookup ON api_keys;
DROP POLICY IF EXISTS t_isolation ON api_keys;
DROP TABLE IF EXISTS api_keys;

-- Dropping a role needs the administrative role again.
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nx_auth') THEN
    EXECUTE 'REASSIGN OWNED BY nx_auth TO CURRENT_USER';
    EXECUTE 'DROP OWNED BY nx_auth';
    DROP ROLE nx_auth;
  END IF;
END
$$;
