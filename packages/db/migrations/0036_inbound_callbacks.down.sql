SET LOCAL ROLE nx_migrator;

REVOKE ALL ON inbound_events FROM nx_app, nx_operator;
DROP TABLE IF EXISTS inbound_events;

ALTER TABLE provider_connections
  DROP CONSTRAINT IF EXISTS ck_callback_pair,
  DROP CONSTRAINT IF EXISTS ck_callback_secret_ref,
  DROP COLUMN IF EXISTS callback_algorithm,
  DROP COLUMN IF EXISTS callback_header,
  DROP COLUMN IF EXISTS callback_secret_ref,
  DROP COLUMN IF EXISTS callback_slug;
