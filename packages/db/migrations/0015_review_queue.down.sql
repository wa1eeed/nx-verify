SET LOCAL ROLE nx_migrator;

ALTER TABLE tenants DROP COLUMN IF EXISTS review_sla_hours;

REVOKE ALL ON review_cases FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON review_cases;
DROP TABLE IF EXISTS review_cases;
