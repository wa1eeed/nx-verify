-- 0057: proving that a company owns the domain it claims.
--
-- `sso_domains.verified_at` has gated routing since 0022: an unverified domain routes nobody,
-- because a company that could claim a domain it does not own could claim the addresses of a
-- company that does. Nothing could ever set it. `addSsoDomain` took a `verified` flag and its
-- only caller was a test, so single sign on could be configured and could never work, while
-- its form sat on the login screen of every deployment.
--
-- The proof is a DNS TXT record, because that is the one thing only the domain's owner can
-- publish. We give them a token, they put it in their zone, and we look it up. No mail, no
-- file on a web server: a mailbox at a domain is not the domain, and a file proves only that
-- somebody can write to one host.

SET LOCAL ROLE nx_migrator;

ALTER TABLE sso_domains
  -- Random, and shown to the subscriber so they can publish it. Not a secret: it proves
  -- control of the zone, and a token that is worthless to anybody who cannot publish DNS for
  -- that domain is a token that does not need protecting.
  ADD COLUMN proof_token text,
  ADD COLUMN checked_at timestamptz,
  -- Why the last check did not pass, in our own words, so the screen can say «the record is
  -- not there yet» rather than leaving somebody to guess.
  ADD COLUMN last_error text;

COMMENT ON COLUMN sso_domains.proof_token IS
  'The value the domain must publish as a TXT record. Cleared once the domain is proved.';

-- A proved domain keeps no pending proof, the same exclusivity the notification channels
-- carry: a row that is both is a bug worth failing on rather than reasoning about.
ALTER TABLE sso_domains
  ADD CONSTRAINT ck_sso_domain_settled
    CHECK (verified_at IS NULL OR proof_token IS NULL);

RESET ROLE;
