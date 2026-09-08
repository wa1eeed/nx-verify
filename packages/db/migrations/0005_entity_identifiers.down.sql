SET LOCAL ROLE nx_migrator;

REVOKE ALL ON entity_identifiers FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON entity_identifiers;
DROP TABLE IF EXISTS entity_identifiers;
