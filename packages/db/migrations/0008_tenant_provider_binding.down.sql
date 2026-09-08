SET LOCAL ROLE nx_migrator;

REVOKE ALL ON tenant_provider_binding FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON tenant_provider_binding;
DROP TABLE IF EXISTS tenant_provider_binding;
