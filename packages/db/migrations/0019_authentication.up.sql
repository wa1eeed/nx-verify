-- 0019: proving who you are.
--
-- Sessions and roles exist. This is the step before them: turning a person at a keyboard
-- into a session.
--
-- A password is not an API key, and the two are stored differently on purpose. An API key
-- is 256 bits we generated, so there is nothing to brute force and a slow hash would only
-- add latency to every request; plain SHA-256 is correct there. A password is chosen by a
-- human, is short, and is probably reused elsewhere, so it needs a deliberately slow
-- derivation with a salt of its own. The same reasoning, applied to different inputs,
-- gives opposite answers, which is why it is written down here rather than left to
-- whoever reads the two files next.
--
-- Login needs to find a person before a tenant is in scope, which is the same problem the
-- API key lookup has. The answer is the same too: a workspace slug the customer knows, so
-- the lookup is scoped by something the caller supplies rather than by a scan across
-- every tenant.

SET LOCAL ROLE nx_migrator;

ALTER TABLE tenants ADD COLUMN slug text;

-- Every existing tenant gets one, and it is required from here on.
UPDATE tenants SET slug = 'tenant-' || left(id::text, 8) WHERE slug IS NULL;

ALTER TABLE tenants
  ALTER COLUMN slug SET NOT NULL,
  ADD CONSTRAINT ck_tenant_slug CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$');

CREATE UNIQUE INDEX uq_tenant_slug ON tenants (slug);

-- A workspace cannot exist without a slug, because a person signing in has to name the
-- workspace they are signing in to. Generating one when it is not supplied means creating
-- a tenant cannot forget it, and an operator can still choose a readable one.
CREATE FUNCTION app.tenants_default_slug() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.slug IS NULL THEN
    NEW.slug := 'tenant-' || left(replace(NEW.id::text, '-', ''), 12);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenants_default_slug
  BEFORE INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION app.tenants_default_slug();

CREATE TABLE user_credentials (
  tenant_id     uuid NOT NULL,
  user_id       uuid NOT NULL,
  -- scrypt output. Slow on purpose.
  password_hash bytea NOT NULL,
  salt          bytea NOT NULL,
  algorithm     text NOT NULL DEFAULT 'scrypt',
  -- The cost parameters used, stored with the hash so they can be raised later without
  -- invalidating every existing password.
  params        jsonb NOT NULL,
  must_change   boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT fk_credentials_user FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT ck_credential_hash CHECK (octet_length(password_hash) = 64),
  CONSTRAINT ck_credential_salt CHECK (octet_length(salt) = 16)
);

ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON user_credentials
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON user_credentials TO nx_app;

-- Failed attempts, so an account can be locked before a guessing run gets anywhere.
CREATE TABLE login_attempts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  uuid,
  user_id    uuid,
  succeeded  boolean NOT NULL,
  ip         inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_login_attempts_recent ON login_attempts (tenant_id, user_id, created_at DESC);

-- This table carries tenant_id, so it carries row level security. There is no exemption
-- for a table that happens to be written by a definer function: guard 02 enumerates the
-- catalogue, and a table left bare is a table of tenant data with no second layer.
--
-- Two policies. The tenant may read its own attempts, which is what a security screen
-- would show. The auth role may write them, because a login is being attempted before any
-- tenant is in scope.
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY t_isolation ON login_attempts
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

REVOKE ALL ON login_attempts FROM PUBLIC;
GRANT SELECT ON login_attempts TO nx_app;

GRANT SELECT ON user_credentials TO nx_auth;
CREATE POLICY auth_lookup ON user_credentials
  FOR SELECT
  TO nx_auth
  USING (true);

GRANT SELECT, INSERT ON login_attempts TO nx_auth;
GRANT USAGE, SELECT ON SEQUENCE login_attempts_id_seq TO nx_auth;

CREATE POLICY auth_write ON login_attempts
  TO nx_auth
  USING (true)
  WITH CHECK (true);
GRANT SELECT ON tenants TO nx_auth;
CREATE POLICY auth_lookup ON tenants
  FOR SELECT
  TO nx_auth
  USING (status = 'active');

/**
 * Everything a login needs, in one lookup.
 *
 * It returns a hash and its parameters, which are useless without the password, and it
 * returns the same shape whether or not the person exists, so the caller cannot learn
 * from the result that an address is registered.
 */
CREATE FUNCTION app.resolve_login(p_slug text, p_email text)
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
  LIMIT 1;
$$;

CREATE FUNCTION app.record_login_attempt(
  p_tenant uuid,
  p_user uuid,
  p_succeeded boolean,
  p_ip text
) RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  INSERT INTO login_attempts (tenant_id, user_id, succeeded, ip)
  VALUES (p_tenant, p_user, p_succeeded, p_ip::inet);
$$;

GRANT CREATE ON SCHEMA app TO nx_auth;
ALTER FUNCTION app.resolve_login(text, text) OWNER TO nx_auth;
ALTER FUNCTION app.record_login_attempt(uuid, uuid, boolean, text) OWNER TO nx_auth;
REVOKE CREATE ON SCHEMA app FROM nx_auth;

REVOKE ALL ON FUNCTION app.resolve_login(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_login_attempt(uuid, uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_login(text, text) TO nx_app;
GRANT EXECUTE ON FUNCTION app.record_login_attempt(uuid, uuid, boolean, text) TO nx_app;
