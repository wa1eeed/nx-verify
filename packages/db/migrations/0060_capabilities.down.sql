-- Undo 0060. The guard goes back to reading the role column, which means the two roles
-- this migration added have to go first: a person left on FINANCE would fail the restored
-- CHECK and a person left on COMPLIANCE would silently lose the right to decide.

SET LOCAL ROLE nx_migrator;

CREATE OR REPLACE FUNCTION app.review_enforce_roles() RETURNS trigger
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

DROP FUNCTION IF EXISTS app.user_can(uuid, uuid, text);
DROP FUNCTION IF EXISTS app.user_capabilities(uuid, uuid);

DROP TABLE IF EXISTS user_capabilities;
DROP TABLE IF EXISTS role_capabilities;
DROP TABLE IF EXISTS capabilities;

-- Nobody keeps a role the restored constraint refuses. Compliance was answerable for
-- decisions, so it lands on the role that may still make them; finance touched no customer
-- and lands on the one that reads.
UPDATE users SET role = 'APPROVER' WHERE role = 'COMPLIANCE';
UPDATE users SET role = 'VIEWER' WHERE role = 'FINANCE';
UPDATE tenant_idp SET default_role = 'APPROVER' WHERE default_role = 'COMPLIANCE';
UPDATE tenant_idp SET default_role = 'VIEWER' WHERE default_role = 'FINANCE';

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('VIEWER', 'ANALYST', 'APPROVER', 'ADMIN')
);

ALTER TABLE tenant_idp DROP CONSTRAINT tenant_idp_default_role_check;
ALTER TABLE tenant_idp ADD CONSTRAINT tenant_idp_default_role_check CHECK (
  default_role IN ('VIEWER', 'ANALYST', 'APPROVER', 'ADMIN')
);
