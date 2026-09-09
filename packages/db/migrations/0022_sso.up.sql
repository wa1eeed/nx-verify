-- 0022: signing in with the subscriber's own identity provider.
--
-- Password login exists. This is the other door, and for a company of any size it is the
-- only one they will accept: people join and leave through the customer's directory, and
-- an account here that outlives someone's employment is the customer's problem to explain
-- to their auditor, not ours to create.
--
-- The binding is at the level of the subscribing company, not the employee, which is the
-- same shape as tenant_provider_binding. An employee does not choose an identity provider
-- any more than they choose a data provider.
--
-- Three tables and no more. The provider configuration, the email domains that route to
-- it, and the link between a person here and a subject there. Plus a short lived record
-- of a login in flight, because a callback arrives carrying nothing but a state value and
-- has to be recognised.
--
-- On rule 10: the client secret is a KMS reference like every other credential. A secret
-- in a column is a secret in every backup.

SET LOCAL ROLE nx_migrator;

CREATE TABLE tenant_idp (
  tenant_id              uuid PRIMARY KEY REFERENCES tenants(id),
  protocol               text NOT NULL DEFAULT 'OIDC' CHECK (protocol IN ('OIDC')),
  issuer                 text NOT NULL,
  client_id              text NOT NULL,
  -- Rule 10. A pointer, never the secret.
  client_secret_ref      text NOT NULL,
  discovery_url          text NOT NULL,
  -- Cached from discovery so a login does not depend on the provider answering twice.
  authorization_endpoint text,
  token_endpoint         text,
  jwks_uri               text,
  discovered_at          timestamptz,
  -- Which claim carries the groups, and what those groups mean here.
  role_claim             text NOT NULL DEFAULT 'groups',
  role_map               jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The role for someone who matches no group. NULL means refuse them, which is the
  -- right default for a platform that can spend the customer's money.
  default_role           text CHECK (default_role IN ('VIEWER', 'ANALYST', 'APPROVER', 'ADMIN')),
  -- Whether a person unknown here may be created on first sign in.
  allow_jit              boolean NOT NULL DEFAULT true,
  -- When true, app.resolve_login stops answering for this tenant and the password door
  -- is closed. A customer who bought single sign on wants exactly one way in.
  enforce_sso            boolean NOT NULL DEFAULT false,
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_idp ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_idp FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON tenant_idp
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_idp TO nx_app;

-- Which company an address belongs to. Globally unique, because an address cannot be
-- ambiguous between two subscribers: whoever proved the domain first owns the route.
CREATE TABLE sso_domains (
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  domain     text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, domain),
  CONSTRAINT ck_sso_domain CHECK (domain = lower(domain) AND domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$')
);

CREATE UNIQUE INDEX uq_sso_domain ON sso_domains (domain);

ALTER TABLE sso_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_domains FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON sso_domains
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON sso_domains TO nx_app;

-- The link between a person here and a subject at the provider.
--
-- The match is on (issuer, subject), never on the email address. A directory lets people
-- change their address, and matching on it would either create a second account for the
-- same person or, worse, hand one person's account to another who was given their old
-- address.
CREATE TABLE user_identities (
  tenant_id     uuid NOT NULL,
  user_id       uuid NOT NULL,
  issuer        text NOT NULL,
  subject       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  PRIMARY KEY (tenant_id, issuer, subject),
  CONSTRAINT fk_identity_user FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_identity_user ON user_identities (tenant_id, user_id);

ALTER TABLE user_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_identities FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON user_identities
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON user_identities TO nx_app;
GRANT SELECT ON user_identities TO nx_retention;

-- A login in flight.
--
-- The state and the nonce are stored as hashes, like every other token here: they are
-- only ever compared, so the column never needs to hold the value. The PKCE verifier is
-- the exception and is stored as it is, because it has to be sent to the provider at the
-- end of the flow. It is single use and expires in minutes.
CREATE TABLE sso_login_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  state_hash   bytea NOT NULL,
  nonce_hash   bytea NOT NULL,
  code_verifier text NOT NULL,
  redirect_uri text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  CONSTRAINT ck_state_hash CHECK (octet_length(state_hash) = 32),
  CONSTRAINT ck_nonce_hash CHECK (octet_length(nonce_hash) = 32)
);

CREATE UNIQUE INDEX uq_sso_state ON sso_login_requests (state_hash);

ALTER TABLE sso_login_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_login_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON sso_login_requests
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON sso_login_requests TO nx_app;

-- Both lookups below happen before a tenant is in scope, which is the same problem the
-- API key and the password login have, and gets the same answer as ADR-022: the narrowest
-- role, one function each, and only the columns the flow needs.
GRANT SELECT ON tenant_idp, sso_domains TO nx_auth;
GRANT SELECT ON sso_login_requests TO nx_auth;

CREATE POLICY auth_lookup ON tenant_idp
  FOR SELECT
  TO nx_auth
  USING (status = 'active');

CREATE POLICY auth_lookup ON sso_domains
  FOR SELECT
  TO nx_auth
  USING (verified_at IS NOT NULL);

CREATE POLICY auth_lookup ON sso_login_requests
  FOR SELECT
  TO nx_auth
  USING (consumed_at IS NULL);

/**
 * Where does this address sign in.
 *
 * Takes a domain, not an address, so no email reaches this function and none is logged by
 * it. Returns the provider configuration for the company that proved that domain.
 */
CREATE FUNCTION app.resolve_sso_domain(p_domain text)
  RETURNS TABLE (
    tenant_id uuid,
    issuer text,
    client_id text,
    client_secret_ref text,
    discovery_url text,
    authorization_endpoint text,
    token_endpoint text,
    jwks_uri text,
    role_claim text,
    role_map jsonb,
    default_role text,
    allow_jit boolean
  )
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT i.tenant_id, i.issuer, i.client_id, i.client_secret_ref, i.discovery_url,
         i.authorization_endpoint, i.token_endpoint, i.jwks_uri,
         i.role_claim, i.role_map, i.default_role, i.allow_jit
  FROM sso_domains d
  JOIN tenant_idp i ON i.tenant_id = d.tenant_id
  JOIN tenants t ON t.id = d.tenant_id
  WHERE d.domain = lower(p_domain)
    AND d.verified_at IS NOT NULL
    AND i.status = 'active'
    AND t.status = 'active'
  LIMIT 1;
$$;

/**
 * Which login in flight does this callback belong to.
 *
 * Reads only, and stops at telling the caller which company the callback belongs to. The
 * claim itself is a conditional update made under that company's own scope, so the single
 * use guarantee is enforced by the same policies as everything else rather than by a
 * function that writes with the isolation switched off.
 */
CREATE FUNCTION app.resolve_sso_request(p_state_hash bytea)
  RETURNS TABLE (
    id uuid,
    tenant_id uuid,
    nonce_hash bytea,
    code_verifier text,
    redirect_uri text
  )
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT id, tenant_id, nonce_hash, code_verifier, redirect_uri
  FROM sso_login_requests
  WHERE state_hash = p_state_hash
    AND consumed_at IS NULL
    AND expires_at > now()
  LIMIT 1;
$$;

-- Password login stops answering for a tenant that enforces single sign on. The door is
-- closed in the lookup rather than in the caller, so no route can forget to check.
--
-- The function already belongs to nx_auth, and only its owner may replace it, so the
-- replacement is made under that role rather than by handing ownership around.
GRANT CREATE ON SCHEMA app TO nx_auth;
SET LOCAL ROLE nx_auth;

CREATE OR REPLACE FUNCTION app.resolve_login(p_slug text, p_email text)
  RETURNS TABLE (
    tenant_id uuid,
    user_id uuid,
    role text,
    display_name text,
    password_hash bytea,
    salt bytea,
    params jsonb,
    must_change boolean,
    recent_failures int
  )
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT
    u.tenant_id,
    u.id,
    u.role,
    u.display_name,
    c.password_hash,
    c.salt,
    c.params,
    c.must_change,
    (SELECT count(*)::int
     FROM login_attempts a
     WHERE a.tenant_id = u.tenant_id
       AND a.user_id = u.id
       AND NOT a.succeeded
       AND a.created_at > now() - interval '15 minutes')
  FROM tenants t
  JOIN users u ON u.tenant_id = t.id
  JOIN user_credentials c ON c.tenant_id = u.tenant_id AND c.user_id = u.id
  WHERE t.slug = p_slug
    AND t.status = 'active'
    AND lower(u.email) = lower(p_email)
    AND u.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM tenant_idp i
      WHERE i.tenant_id = t.id AND i.status = 'active' AND i.enforce_sso
    )
  LIMIT 1;
$$;

SET LOCAL ROLE nx_migrator;

ALTER FUNCTION app.resolve_sso_domain(text) OWNER TO nx_auth;
ALTER FUNCTION app.resolve_sso_request(bytea) OWNER TO nx_auth;
REVOKE CREATE ON SCHEMA app FROM nx_auth;

REVOKE ALL ON FUNCTION app.resolve_sso_domain(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_sso_request(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_sso_domain(text) TO nx_app;
GRANT EXECUTE ON FUNCTION app.resolve_sso_request(bytea) TO nx_app;
