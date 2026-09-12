-- 0036: the provider calling us, rather than us calling the provider.
--
-- Every provider call so far has been outbound and synchronous: we ask, we wait, we
-- answer. Some answers do not arrive that way. An open banking provider refreshes an
-- entity's data on its own schedule and tells us when it has finished, and a registry
-- provider that adopts asynchronous lookups will do the same. Without somewhere for that
-- call to land, those services cannot be offered at all.
--
-- Three things this table deliberately does not hold:
--
-- The body. A provider payload carries account numbers, customer references and names,
-- and rule 4 keeps those out of columns, logs and backups alike. What is kept is the
-- digest of the bytes we verified, which proves what we checked without keeping what we
-- checked it on.
--
-- A tenant. The call arrives before we know whose it is, so there is no tenant_id here at
-- all. A nullable one would be a column rule 3 requires isolation on and that no policy
-- could isolate, since the row is written before any tenant is known. When resolution is
-- built it gets its own tenant scoped table, which is the right shape for it anyway.
--
-- The secret. The signature is verified against material in the secret store, reached
-- through a kms:// reference like every other credential (rule 10).

SET LOCAL ROLE nx_migrator;

ALTER TABLE provider_connections
  -- The path the provider is given. Opaque on purpose: a URL containing a provider's name
  -- is a provider's name on a public surface, and rule 5 does not care that the caller is
  -- the provider itself. Rotating the slug retires an address without touching a secret.
  ADD COLUMN callback_slug text UNIQUE,
  ADD COLUMN callback_secret_ref text,
  -- How this provider signs. Data rather than a branch per provider: Lean sends
  -- HMAC-SHA512 hex in lean-signature, and the next provider will send something else in
  -- a header of its own choosing.
  ADD COLUMN callback_header text NOT NULL DEFAULT 'x-nx-provider-signature',
  ADD COLUMN callback_algorithm text NOT NULL DEFAULT 'sha256'
    CHECK (callback_algorithm IN ('sha256', 'sha512')),
  ADD CONSTRAINT ck_callback_secret_ref CHECK (
    callback_secret_ref IS NULL OR callback_secret_ref LIKE 'kms://%'
  ),
  -- An address with no secret behind it would accept anything that reached it.
  ADD CONSTRAINT ck_callback_pair CHECK (
    callback_slug IS NULL OR callback_secret_ref IS NOT NULL
  );

CREATE TABLE inbound_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL REFERENCES provider_catalog(code) ON DELETE CASCADE,
  environment  text NOT NULL CHECK (environment IN ('sandbox', 'live')),
  event_type   text NOT NULL,
  -- The provider's own id for this delivery, which is what makes a redelivery the same
  -- event rather than a second one. Falls back to the body digest where a provider sends
  -- no id, so a retry is still recognised.
  external_id  text NOT NULL,
  -- SHA-256 of the exact bytes the signature was checked against.
  body_digest  text NOT NULL,
  status       text NOT NULL DEFAULT 'RECEIVED'
    CHECK (status IN ('RECEIVED', 'MATCHED', 'UNMATCHED', 'PROCESSED')),
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, environment, external_id)
);

CREATE INDEX ix_inbound_recent ON inbound_events (received_at DESC);
CREATE INDEX ix_inbound_unmatched ON inbound_events (status) WHERE status = 'RECEIVED';

-- A row names a provider, so no subscriber role may read it (rule 5). The API writes and
-- the worker reads, both as nx_app, and staff read it to answer why a callback did
-- nothing.
REVOKE ALL ON inbound_events FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON inbound_events TO nx_app;
GRANT SELECT ON inbound_events TO nx_operator;
