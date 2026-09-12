SET LOCAL ROLE nx_migrator;

DROP TRIGGER IF EXISTS trg_api_keys_environment ON api_keys;
DROP FUNCTION IF EXISTS app.api_keys_environment_follows_workspace();
