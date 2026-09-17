SET LOCAL ROLE nx_migrator;

ALTER TABLE sso_domains DROP CONSTRAINT ck_sso_domain_settled;

ALTER TABLE sso_domains
  DROP COLUMN proof_token,
  DROP COLUMN checked_at,
  DROP COLUMN last_error;

RESET ROLE;
