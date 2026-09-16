-- 0049: a second factor for the panel, and sessions that fall when credentials change.
--
-- SEC-02. The panel decides prices, sees every subscriber and moves balances, and a password
-- alone opened it. Every member of staff now carries a time based one time password: the
-- secret is sealed with the deployment's master key exactly as an identifier is (rule 4 and
-- rule 10, no credential in the clear and no key in a table), and the recovery codes are
-- sealed the way a password is, one salt each, and marked when used.
--
-- totp_last_step is the last step this account signed in with, so a code somebody read over a
-- shoulder cannot be used a second time.
--
-- SEC-04. A session named an account and an expiry, so it survived a password change, a
-- demotion and a disabling until it expired eight hours later. credential_version rises with
-- every such change, the session carries the version it was issued under, and a session whose
-- version is behind is refused on its next request.

SET LOCAL ROLE nx_migrator;

ALTER TABLE operator_accounts
  ADD COLUMN credential_version int NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  -- AES-256-GCM under a key derived from the master key for the panel, never the key itself.
  ADD COLUMN totp_secret_enc bytea,
  ADD COLUMN totp_key_version int,
  -- Set the moment a first code proves the authenticator holds the same secret.
  ADD COLUMN totp_confirmed_at timestamptz,
  ADD COLUMN totp_last_step bigint,
  -- [{ hash, salt, params, used_at }], each code sealed on its own.
  ADD COLUMN recovery_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT ck_operator_totp_sealed CHECK (
    (totp_secret_enc IS NULL AND totp_key_version IS NULL AND totp_confirmed_at IS NULL)
    OR (totp_secret_enc IS NOT NULL AND totp_key_version IS NOT NULL)
  );

COMMENT ON COLUMN operator_accounts.credential_version IS
  'Rises with every password, role or status change. A session issued under an older version is refused.';
