-- 0062: the account a subscriber transfers to, set in the panel rather than in the deployment.
--
-- It lived in environment variables, which made changing a bank account a redeployment and
-- put the answer to «where do I send the money» somewhere the person who knows it cannot
-- reach. It is not a secret: it is printed on the screen of every subscriber who buys credit,
-- and an IBAN that only one engineer can change is an outage waiting for a bank merger.
--
-- One row, like the rest of platform_settings.

SET LOCAL ROLE nx_migrator;

ALTER TABLE platform_settings
  ADD COLUMN bank_account_name text CHECK (
    bank_account_name IS NULL OR length(bank_account_name) BETWEEN 2 AND 120
  ),
  ADD COLUMN bank_name text CHECK (bank_name IS NULL OR length(bank_name) BETWEEN 2 AND 120),
  -- Stored as the bank writes it, without spaces, and shown in groups of four (ADR-127).
  ADD COLUMN bank_iban text CHECK (bank_iban IS NULL OR bank_iban ~ '^SA[0-9]{22}$'),
  -- What a subscriber should write on the transfer so we can match it. The reference of the
  -- request is the thing that matches; this is the sentence around it.
  ADD COLUMN transfer_note text CHECK (transfer_note IS NULL OR length(transfer_note) <= 200);

COMMENT ON COLUMN platform_settings.bank_iban IS
  'The platform''s own account, shown to subscribers buying credit. Not a secret, and not a subscriber identifier: rule 4 is about the people being verified.';
