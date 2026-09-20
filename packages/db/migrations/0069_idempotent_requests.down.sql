SET LOCAL ROLE nx_migrator;

DROP POLICY IF EXISTS t_isolation ON idempotent_requests;
REVOKE ALL ON idempotent_requests FROM nx_app, nx_retention;
DROP TABLE IF EXISTS idempotent_requests;
