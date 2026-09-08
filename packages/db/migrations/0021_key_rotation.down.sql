SET LOCAL ROLE nx_migrator;

ALTER TABLE evidence DROP COLUMN IF EXISTS key_version;

DROP INDEX IF EXISTS ix_ident_key_version;
ALTER TABLE entity_identifiers DROP COLUMN IF EXISTS key_version;

REVOKE ALL ON key_versions FROM nx_app, nx_operator;
DROP TABLE IF EXISTS key_versions;
