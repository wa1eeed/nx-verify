SET LOCAL ROLE nx_migrator;

REVOKE ALL ON provider_endpoints FROM nx_app, nx_operator;
DROP TABLE IF EXISTS provider_endpoints;
