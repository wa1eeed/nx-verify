-- 0058: a company signing itself up, before it has a workspace.
--
-- Until now a subscriber existed only because a member of staff made one. Self service
-- registration was deferred for one stated reason: registration without proving an address is
-- an abuse surface, not a feature. The platform can send mail now, so it is buildable.
--
-- **The workspace is not created until the address is proved.** The alternative, creating a
-- tenant and marking it pending, leaves half made workspaces behind for every abandoned form
-- and a sweep to clean them up, and a tenant row is the one thing in this platform that
-- everything else hangs from. So the answers wait here instead, and a tenant appears only when
-- somebody has read the code we sent.
--
-- What stops abuse after that is not this table: it is the wallet. A new workspace has no
-- balance, and no verification runs without one. Somebody who registers a hundred times has a
-- hundred empty workspaces and has cost us nothing.

SET LOCAL ROLE nx_migrator;

CREATE TABLE signup_intents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A work address is not a personal identifier under rule 4 (ADR-039), so it is stored as
  -- typed: it is what the code is sent to and what the account is made with.
  email        text NOT NULL,
  /*
   * Everything else the form asked, sealed.
   *
   * The unified number is in there, and rule 4 forbids an identifier in the clear in any
   * column: guard 05 walks the whole catalogue looking for exactly that. There is no tenant
   * yet to hold a per tenant key, so the payload is sealed under a key derived from the
   * platform's root for this one purpose, and opened once when the workspace is made.
   */
  payload_enc  bytea NOT NULL,
  key_version  int NOT NULL,
  -- Six digits, hashed with the intent's own id as salt, like every other code here.
  code_hash    bytea NOT NULL CHECK (octet_length(code_hash) = 32),
  attempts     int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  ip           inet
);

COMMENT ON TABLE signup_intents IS
  'A registration waiting for its address to be proved. No workspace exists until it is. The answers are sealed: the unified number is among them.';

-- One live intent per address: asking again replaces it, so a mailbox with three codes in it
-- never means three rows that could each become a workspace.
CREATE UNIQUE INDEX uq_signup_live ON signup_intents (lower(email))
  WHERE consumed_at IS NULL;

CREATE INDEX ix_signup_expiry ON signup_intents (expires_at);

-- No tenant_id at all, and deliberately so. This row exists before any tenant does, so there
-- is nothing to scope it by, and a tenant_id here would be a column guard 02 rightly demands
-- row level security for on a table that cannot have it. Which registration became which
-- workspace is recorded in that workspace's own audit log, where the question belongs.
--
-- It is reached only by the sign up path, which knows an intent's id and its code, and holds
-- nothing readable without the platform key.
REVOKE ALL ON signup_intents FROM PUBLIC;
-- DELETE as well: asking again for the same address replaces what was waiting, so a
-- mailbox with three codes in it never means three rows that could each become a workspace.
GRANT SELECT, INSERT, UPDATE, DELETE ON signup_intents TO nx_app;
-- The retention sweep clears what was abandoned or spent.
GRANT SELECT, DELETE ON signup_intents TO nx_retention;

RESET ROLE;
