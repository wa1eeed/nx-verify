SET LOCAL ROLE nx_migrator;

REVOKE INSERT, UPDATE, DELETE ON tenant_modules FROM nx_app;

RESET ROLE;
