-- 0018: the customer's own people.
--
-- Until now review_cases recorded who decided and who approved as free text. Four eyes
-- was therefore a comparison of two strings, and any string would do. This makes those
-- columns references to real people with real roles, so the control compares identities
-- rather than spellings.
--
-- docs/01-blueprint.md section 6.2 names four roles: viewer, analyst, approver, manager.
-- The separation that matters is between the third and the second: an analyst decides, an
-- approver signs off, and the database refuses to let one person be both on one case.
--
-- On rule 4: a staff email is stored in the clear, and that is not a contradiction. Rule 4
-- protects the identifiers of subjects, the people and companies being verified, whose
-- national ids we hold because a customer asked us to check them. A login address belongs
-- to the customer's own employee, is chosen by them, and is required to sign in. The two
-- are different categories of data with different reasons for existing.

SET LOCAL ROLE nx_migrator;

CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  email        text NOT NULL,
  display_name text NOT NULL,
  role         text NOT NULL CHECK (role IN ('VIEWER', 'ANALYST', 'APPROVER', 'ADMIN')),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  CONSTRAINT uq_users_tenant_id UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX uq_user_email ON users (tenant_id, lower(email));

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON users
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON users TO nx_app;
GRANT SELECT ON users TO nx_retention;

-- Sessions, stored the way API keys are: a hash and nothing else. The token exists once,
-- in the response that created it.
CREATE TABLE user_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  user_id    uuid NOT NULL,
  token_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip         inet,
  CONSTRAINT fk_session_user FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
  CONSTRAINT ck_session_hash CHECK (octet_length(token_hash) = 32)
);

CREATE UNIQUE INDEX uq_session_hash ON user_sessions (token_hash);
CREATE INDEX ix_session_user ON user_sessions (tenant_id, user_id) WHERE revoked_at IS NULL;

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON user_sessions
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON user_sessions TO nx_app;
GRANT SELECT ON user_sessions TO nx_retention;

-- Resolving a session determines the tenant, so like the API key lookup it cannot be
-- tenant scoped. Same answer as ADR-022: the narrowest possible role, one function, and
-- four identity columns out.
GRANT SELECT ON user_sessions, users TO nx_auth;

CREATE POLICY auth_lookup ON user_sessions
  FOR SELECT
  TO nx_auth
  USING (revoked_at IS NULL);

CREATE POLICY auth_lookup ON users
  FOR SELECT
  TO nx_auth
  USING (status = 'active');

CREATE FUNCTION app.resolve_session(hash bytea)
  RETURNS TABLE (tenant_id uuid, user_id uuid, role text, display_name text)
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT s.tenant_id, s.user_id, u.role, u.display_name
  FROM user_sessions s
  JOIN users u ON u.tenant_id = s.tenant_id AND u.id = s.user_id
  WHERE s.token_hash = hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND u.status = 'active'
  LIMIT 1;
$$;

GRANT CREATE ON SCHEMA app TO nx_auth;
ALTER FUNCTION app.resolve_session(bytea) OWNER TO nx_auth;
REVOKE CREATE ON SCHEMA app FROM nx_auth;
REVOKE ALL ON FUNCTION app.resolve_session(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_session(bytea) TO nx_app;

-- The review queue now names people, not strings.
--
-- This runs before first deployment, so there is nothing to migrate. A later change of
-- this shape would need a backfill, and would deserve its own migration to do it.
ALTER TABLE review_cases DROP CONSTRAINT ck_review_four_eyes;
ALTER TABLE review_cases DROP CONSTRAINT ck_review_decision_complete;
ALTER TABLE review_cases DROP CONSTRAINT ck_review_approval_after_decision;
ALTER TABLE review_cases DROP CONSTRAINT ck_review_closed;

ALTER TABLE review_cases
  ALTER COLUMN assigned_to TYPE uuid USING NULL,
  ALTER COLUMN decided_by  TYPE uuid USING NULL,
  ALTER COLUMN approved_by TYPE uuid USING NULL;

ALTER TABLE review_cases
  ADD CONSTRAINT fk_review_assigned FOREIGN KEY (tenant_id, assigned_to) REFERENCES users (tenant_id, id),
  ADD CONSTRAINT fk_review_decided  FOREIGN KEY (tenant_id, decided_by)  REFERENCES users (tenant_id, id),
  ADD CONSTRAINT fk_review_approved FOREIGN KEY (tenant_id, approved_by) REFERENCES users (tenant_id, id);

ALTER TABLE review_cases
  ADD CONSTRAINT ck_review_four_eyes CHECK (
    approved_by IS NULL OR decided_by IS NULL OR approved_by <> decided_by
  ),
  ADD CONSTRAINT ck_review_decision_complete CHECK (
    (outcome IS NULL AND decided_by IS NULL AND decided_at IS NULL)
    OR (outcome IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL
        AND decision_note IS NOT NULL AND length(btrim(decision_note)) > 0)
  ),
  ADD CONSTRAINT ck_review_approval_after_decision CHECK (
    approved_by IS NULL OR (outcome IS NOT NULL AND approved_at IS NOT NULL)
  ),
  ADD CONSTRAINT ck_review_closed CHECK (
    status <> 'CLOSED' OR (approved_by IS NOT NULL AND closed_at IS NOT NULL)
  );

-- A CHECK cannot read another table, so the role requirement is a trigger. It belongs in
-- the database for the same reason four eyes does: a rule that only exists in application
-- code is a rule a hotfix removes.
CREATE FUNCTION app.review_enforce_roles() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_role text;
BEGIN
  IF NEW.decided_by IS NOT NULL AND NEW.decided_by IS DISTINCT FROM OLD.decided_by THEN
    SELECT role INTO actor_role FROM users
     WHERE tenant_id = NEW.tenant_id AND id = NEW.decided_by;
    IF actor_role NOT IN ('ANALYST', 'APPROVER', 'ADMIN') THEN
      RAISE EXCEPTION 'a viewer cannot decide a review case' USING ERRCODE = 'NX005';
    END IF;
  END IF;

  IF NEW.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    SELECT role INTO actor_role FROM users
     WHERE tenant_id = NEW.tenant_id AND id = NEW.approved_by;
    IF actor_role NOT IN ('APPROVER', 'ADMIN') THEN
      RAISE EXCEPTION 'only an approver may approve a review case' USING ERRCODE = 'NX005';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_review_enforce_roles
  BEFORE UPDATE ON review_cases
  FOR EACH ROW EXECUTE FUNCTION app.review_enforce_roles();
