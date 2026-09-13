-- 0044: what the administration panel needs to manage the data source connection.
--
-- The owner asked for the connection's credentials, for the sandbox and for production,
-- to be set and changed from the panel. The material goes to the secret store and never
-- here (rule 10). Two facts about it do belong in the database, and neither is a secret.
--
-- The first is whether the credential works. A panel that saves a secret and then says
-- nothing leaves a person to discover a wrong paste when the first subscriber's run fails.
-- So the result of the last connection test is kept on the connection: when, whether it
-- succeeded, and the status the identity service answered with. Never the response body.
--
-- The second is who changed what. audit_log is a subscriber's own trail and requires a
-- tenant, and a change to the platform's connection belongs to no subscriber. Writing it
-- into every subscriber's trail, as 0035 did, tells each of them about a provider change
-- they must not be able to see (rule 5). So the panel gets a trail of its own, with no
-- tenant column, readable only by the operator role.

SET LOCAL ROLE nx_migrator;

ALTER TABLE provider_connections
  ADD COLUMN last_test_at     timestamptz,
  ADD COLUMN last_test_ok     boolean,
  -- A status line, such as "401" or "timeout". Never a body, never a credential.
  ADD COLUMN last_test_detail text CHECK (last_test_detail IS NULL OR length(last_test_detail) <= 200);

CREATE TABLE operator_audit (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  -- Our own staff, as a string: they are not users of any workspace.
  operator_id text NOT NULL,
  action      text NOT NULL,
  target      text NOT NULL,
  -- What changed, described. References and field names only, never material.
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX ix_operator_audit_target ON operator_audit (target, at DESC);

REVOKE ALL ON operator_audit FROM PUBLIC;
-- Appended to and read, never edited: a trail its subject can rewrite is not a trail.
GRANT SELECT, INSERT ON operator_audit TO nx_operator;
