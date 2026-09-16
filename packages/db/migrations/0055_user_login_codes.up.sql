-- 0055: a second step for the people who use a subscriber's console.
--
-- The panel has had two steps since 0049, with an authenticator, and it keeps it: the panel
-- holds every subscriber and every price, and a code that arrives by mail is not a second
-- factor there because mail is also how a password is recovered. Whoever holds the mailbox
-- holds both.
--
-- A subscriber's own users are a different question. There are many of them, they are not
-- staff, and asking each to enrol an authenticator is the kind of friction that ends with a
-- shared password. A code to the address they already sign in with is a real gain over a
-- password alone, and the honest name for it is a second step rather than a second factor.
--
-- Shaped like the session it eventually mints. The browser holds an opaque handle and the
-- database holds its digest, so a stolen backup is not a stolen login, and the six digits are
-- never stored either. Nothing here is reversible into anything a person typed.

SET LOCAL ROLE nx_migrator;

CREATE TABLE user_login_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,
  -- What the browser carries between the password and the code. Random, and held as a digest
  -- for the same reason a session token is.
  pending_hash bytea NOT NULL UNIQUE CHECK (octet_length(pending_hash) = 32),
  -- The six digits, hashed with the handle as salt so the same code for two people is two
  -- different digests and a stolen table cannot be searched for a known code.
  code_hash    bytea NOT NULL CHECK (octet_length(code_hash) = 32),
  -- Guesses spent. Five is the whole budget: six digits guessed five times is one chance in
  -- two hundred thousand, and the row is dead after that whatever the clock says.
  attempts     int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  ip           inet,
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE user_login_codes IS
  'A sign in held between the password and the code. The handle and the code are both stored as digests; neither is reversible.';

-- One live code per person: asking for another replaces it, so a mailbox full of codes never
-- means a row still waiting to be used.
CREATE UNIQUE INDEX uq_login_code_live ON user_login_codes (tenant_id, user_id)
  WHERE consumed_at IS NULL;

CREATE INDEX ix_login_code_expiry ON user_login_codes (expires_at);

ALTER TABLE user_login_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_login_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON user_login_codes
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

REVOKE ALL ON user_login_codes FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_login_codes TO nx_app;
-- The retention sweep clears what is spent or stale.
GRANT SELECT, DELETE ON user_login_codes TO nx_retention;

-- ── whether a subscriber's users are asked for one ────────────────────────────────────────
--
-- Off until somebody turns it on, and turned on only after a test message has actually
-- arrived: a platform that requires a code it cannot send is a platform nobody can sign in to.
--
-- It fails closed on purpose. When mail is configured and the send fails, the sign in stops
-- rather than waving the person through, because a second step that disappears when a mail
-- service is down is not a second step. The way out of that is this setting, which the panel
-- owner can turn off; the owner's own way in is an authenticator and does not depend on mail.

ALTER TABLE platform_settings
  ADD COLUMN user_second_step text NOT NULL DEFAULT 'off'
    CHECK (user_second_step IN ('off', 'email'));

COMMENT ON COLUMN platform_settings.user_second_step IS
  'Whether a subscriber user is asked for a code mailed to them after their password. Fails closed: turn it off here if mail is down.';

RESET ROLE;
