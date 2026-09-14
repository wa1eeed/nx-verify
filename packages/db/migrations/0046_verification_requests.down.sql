SET LOCAL ROLE nx_migrator;

ALTER TABLE products DROP COLUMN IF EXISTS summary_ar;

DROP TABLE IF EXISTS tenant_preferences;
DROP TABLE IF EXISTS verification_request_checks;
DROP TABLE IF EXISTS verification_requests;
