SET LOCAL ROLE nx_migrator;

-- The public check goes back to three values.
GRANT CREATE ON SCHEMA app TO nx_auth;
SET LOCAL ROLE nx_auth;

DROP FUNCTION IF EXISTS app.resolve_evidence_token(text);

CREATE FUNCTION app.resolve_evidence_token(token text)
  RETURNS TABLE (content_hash bytea, signed_at timestamptz, expires_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT e.content_hash, e.signed_at, e.expires_at
  FROM evidence e
  WHERE e.public_token = token
    AND (e.expires_at IS NULL OR e.expires_at > now())
  LIMIT 1;
$$;

SET LOCAL ROLE nx_migrator;
REVOKE CREATE ON SCHEMA app FROM nx_auth;
REVOKE ALL ON FUNCTION app.resolve_evidence_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_evidence_token(text) TO nx_app;

DROP POLICY IF EXISTS operator_link_sandbox ON tenants;
REVOKE UPDATE (sandbox_of) ON tenants FROM nx_operator;

DROP TRIGGER IF EXISTS trg_tenants_no_nested_sandbox ON tenants;
DROP FUNCTION IF EXISTS app.tenants_no_nested_sandbox();

DROP INDEX IF EXISTS uq_tenant_sandbox;

ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS ck_sandbox_not_self,
  DROP COLUMN IF EXISTS sandbox_of;
