SET LOCAL ROLE nx_migrator;

REVOKE ALL ON batch_items FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON batch_items;
DROP TABLE IF EXISTS batch_items;

REVOKE ALL ON batches FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON batches;
DROP TABLE IF EXISTS batches;
