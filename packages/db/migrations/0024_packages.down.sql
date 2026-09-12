SET LOCAL ROLE nx_migrator;

DROP POLICY IF EXISTS t_isolation ON product_usage;
REVOKE ALL ON product_usage FROM nx_app, nx_retention;
DROP TABLE IF EXISTS product_usage;

DROP POLICY IF EXISTS operator_manage ON tenant_product_overrides;
DROP POLICY IF EXISTS t_isolation ON tenant_product_overrides;
REVOKE ALL ON tenant_product_overrides FROM nx_app, nx_operator;
DROP TABLE IF EXISTS tenant_product_overrides;

DROP POLICY IF EXISTS operator_manage ON tenant_subscriptions;
DROP POLICY IF EXISTS t_isolation ON tenant_subscriptions;
REVOKE ALL ON tenant_subscriptions FROM nx_app, nx_operator;
DROP TABLE IF EXISTS tenant_subscriptions;

REVOKE ALL ON package_products FROM nx_app, nx_operator;
DROP TABLE IF EXISTS package_products;

REVOKE ALL ON packages FROM nx_app, nx_operator;
DROP TABLE IF EXISTS packages;
