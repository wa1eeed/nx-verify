-- 0001: cluster roles and the internal "app" schema.
-- Runs as the administrative role. Every later migration runs as nx_migrator.
--
-- Rule 12: the owner role and the application role are separate. The owner role owns
-- the tables and runs migrations only. The application role owns nothing and never
-- bypasses row level security.
--
-- No role in this system is created with BYPASSRLS. Combined with FORCE ROW LEVEL
-- SECURITY in migration 0003 this means tenant isolation has no exception path.
--
-- Roles are created without a password. Passwords are assigned by the migrate runner
-- from the environment, so no credential ever appears in a migration file, in a backup
-- of this repository, or in the schema ledger.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nx_migrator') THEN
    CREATE ROLE nx_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nx_app') THEN
    CREATE ROLE nx_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nx_retention') THEN
    CREATE ROLE nx_retention LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;

-- The administrative role must be able to SET ROLE into the owner role.
GRANT nx_migrator TO CURRENT_USER;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION nx_migrator;
ALTER SCHEMA app OWNER TO nx_migrator;

GRANT USAGE ON SCHEMA app TO nx_app, nx_retention;
GRANT USAGE ON SCHEMA public TO nx_app, nx_retention;
GRANT CREATE, USAGE ON SCHEMA public TO nx_migrator;

-- The application role may not create objects anywhere.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
