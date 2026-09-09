SET LOCAL ROLE nx_migrator;

DROP POLICY IF EXISTS t_isolation ON notification_deliveries;
REVOKE ALL ON notification_deliveries FROM nx_app, nx_retention;
DROP TABLE IF EXISTS notification_deliveries;

DROP POLICY IF EXISTS t_isolation ON notification_rules;
REVOKE ALL ON notification_rules FROM nx_app;
DROP TABLE IF EXISTS notification_rules;

DROP POLICY IF EXISTS t_isolation ON notification_channels;
REVOKE ALL ON notification_channels FROM nx_app;
DROP TABLE IF EXISTS notification_channels;
