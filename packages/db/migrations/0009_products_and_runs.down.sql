SET LOCAL ROLE nx_migrator;

REVOKE ALL ON run_steps, verification_runs FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON run_steps;
DROP POLICY IF EXISTS t_isolation ON verification_runs;
DROP TABLE IF EXISTS run_steps;
DROP TABLE IF EXISTS verification_runs;

REVOKE ALL ON products, product_steps FROM nx_app, nx_retention;
DROP TABLE IF EXISTS product_steps;
DROP TABLE IF EXISTS products;
