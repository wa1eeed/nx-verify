SET LOCAL ROLE nx_migrator;

-- Deliveries with no rule cannot survive the column becoming required again.
DELETE FROM notification_deliveries WHERE rule_id IS NULL;
ALTER TABLE notification_deliveries ALTER COLUMN rule_id SET NOT NULL;

DROP POLICY IF EXISTS t_isolation ON case_action_log;
REVOKE ALL ON case_action_log FROM nx_app, nx_retention;
DROP TABLE IF EXISTS case_action_log;

DROP POLICY IF EXISTS t_isolation ON case_actions;
REVOKE ALL ON case_actions FROM nx_app;
DROP TABLE IF EXISTS case_actions;
