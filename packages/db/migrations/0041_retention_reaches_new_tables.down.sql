SET LOCAL ROLE nx_migrator;

REVOKE SELECT, DELETE ON inbound_events FROM nx_retention;
