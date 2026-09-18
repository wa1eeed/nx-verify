-- Undo 0062. The deployment goes back to carrying the account in its environment.

SET LOCAL ROLE nx_migrator;

ALTER TABLE platform_settings
  DROP COLUMN IF EXISTS bank_account_name,
  DROP COLUMN IF EXISTS bank_name,
  DROP COLUMN IF EXISTS bank_iban,
  DROP COLUMN IF EXISTS transfer_note;
