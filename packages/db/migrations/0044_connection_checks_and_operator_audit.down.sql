SET LOCAL ROLE nx_migrator;

REVOKE ALL ON operator_audit FROM nx_operator;
DROP TABLE IF EXISTS operator_audit;

ALTER TABLE provider_connections
  DROP COLUMN IF EXISTS last_test_detail,
  DROP COLUMN IF EXISTS last_test_ok,
  DROP COLUMN IF EXISTS last_test_at;
