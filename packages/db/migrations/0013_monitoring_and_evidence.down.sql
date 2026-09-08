SET LOCAL ROLE nx_migrator;

REVOKE INSERT ON audit_log FROM nx_retention;
REVOKE DELETE ON entity_identifiers FROM nx_retention;
REVOKE UPDATE (archived_at) ON entities FROM nx_retention;

REVOKE ALL ON change_severity_rules FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON change_severity_rules;

REVOKE ALL ON entity_scores FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON entity_scores;
DROP TABLE IF EXISTS entity_scores;

DROP FUNCTION IF EXISTS app.resolve_evidence_token(text);
REVOKE ALL ON evidence FROM nx_app, nx_retention, nx_auth;
DROP POLICY IF EXISTS evidence_public_lookup ON evidence;
DROP POLICY IF EXISTS t_isolation ON evidence;
DROP TABLE IF EXISTS evidence;

REVOKE ALL ON change_events FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON change_events;
DROP TABLE IF EXISTS change_events;
DROP TABLE IF EXISTS change_severity_rules;

REVOKE ALL ON monitors FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON monitors;
DROP TABLE IF EXISTS monitors;
