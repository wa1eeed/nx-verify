SET LOCAL ROLE nx_migrator;

DROP POLICY IF EXISTS operator_read ON margin_counters;
DROP POLICY IF EXISTS t_isolation ON margin_counters;
REVOKE ALL ON margin_counters FROM nx_app, nx_operator;
DROP TABLE IF EXISTS margin_counters;
