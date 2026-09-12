-- 0035: the provider's connection details, editable without a deployment.
--
-- Until now a provider's address lived in NX_PROVIDERS, an environment variable read at
-- startup. Changing a sandbox host, pointing a provider at a new base url, or bringing a
-- second provider live therefore meant a redeploy, which is the wrong shape for something
-- that changes on a supplier's timetable rather than ours.
--
-- What is stored here is the connection: which kind of adapter, which address, which
-- authorisation host, how long to wait. What is NOT stored here is the credential. Rule 10
-- has no exception and gains none today: the row holds a kms:// reference and the material
-- lives in a secret store the admin writes through, never in this database and never in a
-- backup of it.
--
-- Two rows per provider, one per environment, because a sandbox host and a production host
-- are different addresses with different credentials, and a platform that cannot tell them
-- apart will one day verify a real company against a test service.

SET LOCAL ROLE nx_migrator;

CREATE TABLE provider_connections (
  provider     text NOT NULL REFERENCES provider_catalog(code) ON DELETE CASCADE,
  environment  text NOT NULL CHECK (environment IN ('sandbox', 'live')),
  -- Which adapter speaks to it. A registry provider needs one host; an open banking one
  -- needs two, because it mints a token at one and asks questions at the other.
  kind         text NOT NULL DEFAULT 'http' CHECK (kind IN ('stub', 'http', 'openbanking')),
  base_url     text,
  auth_url     text,
  -- The reference the secret store holds this environment's credential under. A pointer,
  -- never the material (rule 10).
  credential_ref text,
  timeout_ms   int NOT NULL DEFAULT 20000 CHECK (timeout_ms BETWEEN 1000 AND 120000),
  max_attempts int NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, environment),
  -- A stub needs no address. Everything else does, and an open banking adapter needs both.
  CONSTRAINT ck_connection_urls CHECK (
    kind = 'stub'
    OR (kind = 'http' AND base_url IS NOT NULL)
    OR (kind = 'openbanking' AND base_url IS NOT NULL AND auth_url IS NOT NULL)
  ),
  CONSTRAINT ck_credential_ref CHECK (
    credential_ref IS NULL OR credential_ref LIKE 'kms://%'
  )
);

-- Reading it is learning provider names, so no subscriber role may (rule 5).
REVOKE ALL ON provider_connections FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider_connections TO nx_operator;
-- The application reads it to build the adapter for the call it is about to make, and
-- never writes it: which provider is running is an operator decision.
GRANT SELECT ON provider_connections TO nx_app;
