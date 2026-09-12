-- 0032: a key's environment follows its workspace.
--
-- A key carried an environment chosen by whoever issued it, defaulting to sandbox, while
-- the workspace it belonged to was a real one. So a key labelled sandbox, prefixed
-- nx_test_, ran against production data and returned production answers.
--
-- That is the precise confusion the sandbox exists to prevent, and it cannot be left to
-- the caller to avoid: a sandbox workspace issues test keys and a real workspace issues
-- live ones, and the database is what says so, because the application is the thing that
-- got it wrong.

SET LOCAL ROLE nx_migrator;

CREATE FUNCTION app.api_keys_environment_follows_workspace() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  expected text;
BEGIN
  SELECT CASE WHEN t.sandbox_of IS NULL THEN 'live' ELSE 'sandbox' END
  INTO expected
  FROM tenants t
  WHERE t.id = NEW.tenant_id;

  IF expected IS NULL THEN
    RAISE EXCEPTION 'no such workspace' USING ERRCODE = 'NX007';
  END IF;

  IF NEW.environment <> expected THEN
    RAISE EXCEPTION 'a % workspace issues % keys', expected, expected USING ERRCODE = 'NX007';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_api_keys_environment
  BEFORE INSERT OR UPDATE OF environment, tenant_id ON api_keys
  FOR EACH ROW EXECUTE FUNCTION app.api_keys_environment_follows_workspace();

-- Existing rows predate the rule and are corrected to match their workspace.
UPDATE api_keys k
SET environment = CASE WHEN t.sandbox_of IS NULL THEN 'live' ELSE 'sandbox' END
FROM tenants t
WHERE t.id = k.tenant_id
  AND k.environment <> CASE WHEN t.sandbox_of IS NULL THEN 'live' ELSE 'sandbox' END;
