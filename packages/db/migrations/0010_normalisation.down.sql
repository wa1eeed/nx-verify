SET LOCAL ROLE nx_migrator;

REVOKE ALL ON entity_relations FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON entity_relations;
DROP TABLE IF EXISTS entity_relations;

REVOKE ALL ON step_field_map FROM nx_app, nx_retention;
DROP TABLE IF EXISTS step_field_map;
