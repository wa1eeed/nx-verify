SET LOCAL ROLE nx_migrator;

DROP FUNCTION IF EXISTS app.record_login_attempt(uuid, uuid, boolean, text);
DROP FUNCTION IF EXISTS app.resolve_login(text, text);

DROP POLICY IF EXISTS auth_lookup ON tenants;
REVOKE SELECT ON tenants FROM nx_auth;

REVOKE ALL ON login_attempts FROM nx_app, nx_auth;
DROP POLICY IF EXISTS auth_write ON login_attempts;
DROP POLICY IF EXISTS t_isolation ON login_attempts;
DROP TABLE IF EXISTS login_attempts;

DROP POLICY IF EXISTS auth_lookup ON user_credentials;
REVOKE ALL ON user_credentials FROM nx_app, nx_auth;
DROP POLICY IF EXISTS t_isolation ON user_credentials;
DROP TABLE IF EXISTS user_credentials;

DROP TRIGGER IF EXISTS trg_tenants_default_slug ON tenants;
DROP FUNCTION IF EXISTS app.tenants_default_slug();

DROP INDEX IF EXISTS uq_tenant_slug;
ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS ck_tenant_slug,
  DROP COLUMN IF EXISTS slug;
