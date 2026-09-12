SET LOCAL ROLE nx_migrator;

REVOKE ALL ON provider_connections FROM nx_app, nx_operator;
DROP TABLE IF EXISTS provider_connections;
