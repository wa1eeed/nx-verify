SET LOCAL ROLE nx_migrator;

DROP TRIGGER IF EXISTS trg_review_enforce_roles ON review_cases;
DROP FUNCTION IF EXISTS app.review_enforce_roles();

ALTER TABLE review_cases DROP CONSTRAINT IF EXISTS fk_review_assigned;
ALTER TABLE review_cases DROP CONSTRAINT IF EXISTS fk_review_decided;
ALTER TABLE review_cases DROP CONSTRAINT IF EXISTS fk_review_approved;

ALTER TABLE review_cases
  ALTER COLUMN assigned_to TYPE text USING NULL,
  ALTER COLUMN decided_by  TYPE text USING NULL,
  ALTER COLUMN approved_by TYPE text USING NULL;

DROP FUNCTION IF EXISTS app.resolve_session(bytea);

REVOKE ALL ON user_sessions, users FROM nx_app, nx_retention, nx_auth;
DROP POLICY IF EXISTS auth_lookup ON user_sessions;
DROP POLICY IF EXISTS t_isolation ON user_sessions;
DROP TABLE IF EXISTS user_sessions;

DROP POLICY IF EXISTS auth_lookup ON users;
DROP POLICY IF EXISTS t_isolation ON users;
DROP TABLE IF EXISTS users;
