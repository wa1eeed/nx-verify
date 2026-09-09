SET LOCAL ROLE nx_migrator;

DROP FUNCTION IF EXISTS app.resolve_sso_request(bytea);
DROP FUNCTION IF EXISTS app.resolve_sso_domain(text);

-- Password login goes back to answering without asking about single sign on. Replaced
-- under its owner, as it was created.
GRANT CREATE ON SCHEMA app TO nx_auth;
SET LOCAL ROLE nx_auth;

CREATE OR REPLACE FUNCTION app.resolve_login(p_slug text, p_email text)
  RETURNS TABLE (
    tenant_id uuid,
    user_id uuid,
    role text,
    display_name text,
    password_hash bytea,
    salt bytea,
    params jsonb,
    must_change boolean,
    recent_failures int
  )
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT
    u.tenant_id,
    u.id,
    u.role,
    u.display_name,
    c.password_hash,
    c.salt,
    c.params,
    c.must_change,
    (SELECT count(*)::int
     FROM login_attempts a
     WHERE a.tenant_id = u.tenant_id
       AND a.user_id = u.id
       AND NOT a.succeeded
       AND a.created_at > now() - interval '15 minutes')
  FROM tenants t
  JOIN users u ON u.tenant_id = t.id
  JOIN user_credentials c ON c.tenant_id = u.tenant_id AND c.user_id = u.id
  WHERE t.slug = p_slug
    AND t.status = 'active'
    AND lower(u.email) = lower(p_email)
    AND u.status = 'active'
  LIMIT 1;
$$;

SET LOCAL ROLE nx_migrator;

REVOKE CREATE ON SCHEMA app FROM nx_auth;
REVOKE ALL ON FUNCTION app.resolve_login(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_login(text, text) TO nx_app;

DROP POLICY IF EXISTS auth_lookup ON sso_login_requests;
DROP POLICY IF EXISTS t_isolation ON sso_login_requests;
REVOKE ALL ON sso_login_requests FROM nx_app, nx_auth;
DROP TABLE IF EXISTS sso_login_requests;

DROP POLICY IF EXISTS t_isolation ON user_identities;
REVOKE ALL ON user_identities FROM nx_app, nx_retention;
DROP TABLE IF EXISTS user_identities;

DROP POLICY IF EXISTS auth_lookup ON sso_domains;
DROP POLICY IF EXISTS t_isolation ON sso_domains;
REVOKE ALL ON sso_domains FROM nx_app, nx_auth;
DROP TABLE IF EXISTS sso_domains;

DROP POLICY IF EXISTS auth_lookup ON tenant_idp;
DROP POLICY IF EXISTS t_isolation ON tenant_idp;
REVOKE ALL ON tenant_idp FROM nx_app, nx_auth;
DROP TABLE IF EXISTS tenant_idp;
