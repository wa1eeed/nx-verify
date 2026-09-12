SET LOCAL ROLE nx_migrator;

DROP POLICY IF EXISTS t_isolation ON api_requests;
REVOKE ALL ON api_requests FROM nx_app, nx_retention;
DROP TABLE IF EXISTS api_requests;
