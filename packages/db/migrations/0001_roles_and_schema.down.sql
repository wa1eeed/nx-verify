-- Reverse of 0001. Roles are cluster wide, so ownership is reassigned before they drop.

DROP SCHEMA IF EXISTS app CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nx_app') THEN
    EXECUTE 'REASSIGN OWNED BY nx_app TO CURRENT_USER';
    EXECUTE 'DROP OWNED BY nx_app';
    DROP ROLE nx_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nx_retention') THEN
    EXECUTE 'REASSIGN OWNED BY nx_retention TO CURRENT_USER';
    EXECUTE 'DROP OWNED BY nx_retention';
    DROP ROLE nx_retention;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nx_migrator') THEN
    EXECUTE 'REASSIGN OWNED BY nx_migrator TO CURRENT_USER';
    EXECUTE 'DROP OWNED BY nx_migrator';
    DROP ROLE nx_migrator;
  END IF;
END
$$;
