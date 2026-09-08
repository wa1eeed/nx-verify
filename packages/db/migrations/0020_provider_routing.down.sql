SET LOCAL ROLE nx_migrator;

DROP FUNCTION IF EXISTS app.resolve_providers(uuid, text);

DROP POLICY IF EXISTS operator_audit ON audit_log;
DROP POLICY IF EXISTS operator_read ON tenants;
DROP POLICY IF EXISTS operator_manage ON tenant_provider_binding;

REVOKE ALL ON audit_log, tenants, tenant_provider_binding, provider_catalog FROM nx_operator;

ALTER TABLE tenant_provider_binding
  DROP CONSTRAINT IF EXISTS ck_binding_priority,
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS endpoints,
  DROP COLUMN IF EXISTS updated_at;

DROP TABLE IF EXISTS provider_catalog;

RESET ROLE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nx_operator') THEN
    EXECUTE 'REVOKE USAGE ON SCHEMA app, public FROM nx_operator';
    EXECUTE 'REASSIGN OWNED BY nx_operator TO CURRENT_USER';
    EXECUTE 'DROP OWNED BY nx_operator';
    DROP ROLE nx_operator;
  END IF;
END
$$;
