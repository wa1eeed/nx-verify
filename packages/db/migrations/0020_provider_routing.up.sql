-- 0020: which provider serves which subscriber.
--
-- The binding table has existed since migration 0008, but nothing consulted it to choose
-- a provider: a step named its provider and that is who was called, for every tenant. So
-- the platform could hold several providers and still route everyone to the same one.
--
-- From here the tenant's bindings decide, in priority order, and the provider named in
-- the product is the last resort. A product says which authority it needs; whose pipe we
-- use to reach it is an operational decision that changes with contracts, outages and
-- prices, and a product definition should not have to be edited when any of those move.
--
-- Rule 5 is untouched. The catalogue below carries no tenant_id and no tenant may read
-- it, the routing function returns names only to the application that must place the
-- call, and nothing tenant facing selects from either. Choosing a provider is an operator
-- action, which is why the panel that does it is not in the customer's console.

SET LOCAL ROLE nx_migrator;

-- Role creation needs the administrative role, so it happens before the handover.
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nx_operator') THEN
    -- The operator manages configuration across tenants, and nothing else. It reads no
    -- attestation, no identifier and no run.
    CREATE ROLE nx_operator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;

GRANT nx_operator TO nx_migrator;
GRANT USAGE ON SCHEMA app, public TO nx_operator;

SET LOCAL ROLE nx_migrator;

CREATE TABLE provider_catalog (
  code       text PRIMARY KEY,
  name_ar    text NOT NULL,
  name_en    text NOT NULL,
  -- Endpoints this provider can serve. product_steps.endpoint refers to these.
  endpoints  text[] NOT NULL DEFAULT '{}',
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- No tenant may read the catalogue, because reading it is learning the names.
REVOKE ALL ON provider_catalog FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider_catalog TO nx_operator;

ALTER TABLE tenant_provider_binding
  -- Lower runs first. Several bindings may exist for one tenant, which is how a second
  -- provider is carried ready and inactive: bound, healthy, and next in line.
  ADD COLUMN priority int NOT NULL DEFAULT 100,
  -- NULL means every endpoint this provider serves. A list narrows it, so one provider
  -- can serve the commercial registry while another serves bank verification.
  ADD COLUMN endpoints text[],
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT ck_binding_priority CHECK (priority > 0);

-- The operator manages bindings for every tenant. This is the one policy in the system
-- that crosses tenants, it is restricted to a role that can reach nothing else, and it
-- covers configuration rather than data.
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_provider_binding TO nx_operator;
CREATE POLICY operator_manage ON tenant_provider_binding
  TO nx_operator
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON tenants TO nx_operator;
CREATE POLICY operator_read ON tenants
  FOR SELECT
  TO nx_operator
  USING (true);

GRANT INSERT ON audit_log TO nx_operator;
CREATE POLICY operator_audit ON audit_log
  FOR INSERT
  TO nx_operator
  WITH CHECK (true);

/**
 * Which providers may serve this endpoint for this tenant, most preferred first.
 *
 * Returns names and credential references to the application, which is the only thing
 * that has to know them in order to place a call. It exposes nothing else about the
 * catalogue, and no tenant facing route calls it.
 */
CREATE FUNCTION app.resolve_providers(p_tenant uuid, p_endpoint text)
  RETURNS TABLE (provider text, mode text, credential_ref text, priority int)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT b.provider, b.mode, b.credential_ref, b.priority
  FROM tenant_provider_binding b
  WHERE b.tenant_id = p_tenant
    AND b.health_status <> 'down'
    AND b.activated_at IS NOT NULL
    AND (b.endpoints IS NULL OR p_endpoint = ANY (b.endpoints))
  ORDER BY b.priority, b.provider;
$$;

GRANT EXECUTE ON FUNCTION app.resolve_providers(uuid, text) TO nx_app;
