SET LOCAL ROLE nx_migrator;

REVOKE ALL ON topup_requests FROM nx_app, nx_retention, nx_operator;
DROP TABLE IF EXISTS topup_requests;
REVOKE ALL ON topup_counters FROM nx_app;
DROP TABLE IF EXISTS topup_counters;
