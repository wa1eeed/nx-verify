SET LOCAL ROLE nx_migrator;

DROP POLICY IF EXISTS t_isolation ON case_counters;
REVOKE ALL ON case_counters FROM nx_app;
DROP TABLE IF EXISTS case_counters;

DROP POLICY IF EXISTS t_isolation ON onboarding_case_steps;
REVOKE ALL ON onboarding_case_steps FROM nx_app, nx_retention;
DROP TABLE IF EXISTS onboarding_case_steps;

DROP POLICY IF EXISTS t_isolation ON onboarding_cases;
REVOKE ALL ON onboarding_cases FROM nx_app, nx_retention;
DROP TABLE IF EXISTS onboarding_cases;

DROP POLICY IF EXISTS t_isolation ON onboarding_journey_steps;
REVOKE ALL ON onboarding_journey_steps FROM nx_app;
DROP TABLE IF EXISTS onboarding_journey_steps;

DROP POLICY IF EXISTS t_isolation ON onboarding_journeys;
REVOKE ALL ON onboarding_journeys FROM nx_app;
DROP TABLE IF EXISTS onboarding_journeys;
