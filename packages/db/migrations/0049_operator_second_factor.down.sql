SET LOCAL ROLE nx_migrator;

ALTER TABLE operator_accounts
  DROP CONSTRAINT IF EXISTS ck_operator_totp_sealed,
  DROP COLUMN IF EXISTS recovery_codes,
  DROP COLUMN IF EXISTS totp_last_step,
  DROP COLUMN IF EXISTS totp_confirmed_at,
  DROP COLUMN IF EXISTS totp_key_version,
  DROP COLUMN IF EXISTS totp_secret_enc,
  DROP COLUMN IF EXISTS credential_version;
