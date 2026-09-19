SET LOCAL ROLE nx_migrator;

REVOKE ALL ON sandbox_requests FROM nx_app, nx_retention, nx_operator;
DROP TABLE IF EXISTS sandbox_requests;
