-- 0012: API authentication, webhooks and the audit log.
--
-- Rule 10 again, and this time for our own credentials rather than a provider's. An API
-- key is stored as a SHA-256 hash and a short prefix. The prefix is what the console
-- shows and what a log line may carry; the hash is what a request is matched against.
-- The key itself exists once, in the response that created it, and never again. A stolen
-- database therefore yields no working key.
--
-- Webhook secrets are the same story from the other direction: the customer needs the
-- secret to verify our signature, so it lives in the KMS and this table holds a
-- reference, exactly like a provider credential.

-- Role creation needs the administrative role, so it happens before the migration hands
-- over to the owner. Everything after SET LOCAL ROLE is owned by nx_migrator as usual.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nx_auth') THEN
    CREATE ROLE nx_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;

-- The owner must be a member of nx_auth to hand it the function below.
GRANT nx_auth TO nx_migrator;
GRANT USAGE ON SCHEMA app, public TO nx_auth;

SET LOCAL ROLE nx_migrator;

CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  name         text NOT NULL,
  -- Shown in the console and safe in a log. Never enough to authenticate.
  key_prefix   text NOT NULL,
  key_hash     bytea NOT NULL,
  scopes       text[] NOT NULL DEFAULT '{}',
  environment  text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'live')),
  allowed_ips  inet[],
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  CONSTRAINT ck_api_key_hash_length CHECK (octet_length(key_hash) = 32)
);

CREATE UNIQUE INDEX uq_api_key_hash ON api_keys (key_hash);
CREATE INDEX ix_api_keys_tenant ON api_keys (tenant_id) WHERE revoked_at IS NULL;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON api_keys
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- Authentication has to find the key before a tenant is in context, because the key is
-- what determines the tenant. It is the one lookup in the system that cannot be tenant
-- scoped, and FORCE row level security correctly refuses it to every role including the
-- owner.
--
-- ADR-022: rather than granting BYPASSRLS to anything, which ADR-011 rules out, this is
-- served by a role that can do exactly one thing. nx_auth cannot log in, owns nothing,
-- holds SELECT on this one table, and exists only to own the function below. The
-- function is SECURITY DEFINER so it runs as nx_auth, takes a hash, and returns four
-- identity columns and nothing else. Only nx_app may execute it.
--
-- So the widest privilege in the system belongs to a role with no password, one table,
-- and one caller.
GRANT SELECT ON api_keys TO nx_auth;

CREATE POLICY auth_lookup ON api_keys
  FOR SELECT
  TO nx_auth
  USING (true);

CREATE FUNCTION app.resolve_api_key(hash bytea)
  RETURNS TABLE (tenant_id uuid, api_key_id uuid, scopes text[], environment text)
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT k.tenant_id, k.id, k.scopes, k.environment
  FROM api_keys k
  WHERE k.key_hash = hash AND k.revoked_at IS NULL
  LIMIT 1;
$$;

-- Taking ownership of an object requires CREATE on its schema at that moment. It is
-- granted for the handover and taken away immediately, so nx_auth ends up able to own
-- this one function and to create nothing.
GRANT CREATE ON SCHEMA app TO nx_auth;
ALTER FUNCTION app.resolve_api_key(bytea) OWNER TO nx_auth;
REVOKE CREATE ON SCHEMA app FROM nx_auth;
REVOKE ALL ON FUNCTION app.resolve_api_key(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_api_key(bytea) TO nx_app;

GRANT SELECT, INSERT, UPDATE ON api_keys TO nx_app;
GRANT SELECT ON api_keys TO nx_retention;

CREATE TABLE webhook_endpoints (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  url            text NOT NULL,
  -- Rule 10: a KMS reference, never the signing secret itself.
  secret_ref     text NOT NULL,
  events         text[] NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Needed by the delivery foreign key below, which carries the tenant with it.
  CONSTRAINT uq_webhook_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT ck_webhook_secret_is_a_reference CHECK (
    length(secret_ref) <= 200 AND secret_ref LIKE 'kms://%'
  ),
  CONSTRAINT ck_webhook_url_is_https CHECK (url LIKE 'https://%')
);

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON webhook_endpoints
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_endpoints TO nx_app;
GRANT SELECT ON webhook_endpoints TO nx_retention;

CREATE TABLE webhook_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  endpoint_id   uuid NOT NULL,
  event_type    text NOT NULL,
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed', 'abandoned')),
  attempts      int NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  last_status   int,
  created_at    timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz,
  CONSTRAINT fk_delivery_endpoint FOREIGN KEY (tenant_id, endpoint_id)
    REFERENCES webhook_endpoints (tenant_id, id)
);

CREATE INDEX ix_delivery_due ON webhook_deliveries (next_retry_at)
  WHERE status = 'pending';

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON webhook_deliveries
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON webhook_deliveries TO nx_app;
GRANT SELECT ON webhook_deliveries TO nx_retention;

CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id  uuid NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('USER', 'API_KEY', 'SYSTEM', 'NX_STAFF')),
  actor_id   text NOT NULL,
  action     text NOT NULL,
  target     text,
  ip         inet,
  request_id text,
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX ix_audit_tenant ON audit_log (tenant_id, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON audit_log
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT ON audit_log TO nx_app;
GRANT SELECT ON audit_log TO nx_retention;

-- A partition does not inherit its parent's row level security, its policies or its
-- grants. Access through the parent is covered by the parent's policy, but a partition
-- left bare is a table with tenant data and no isolation of its own, and the day someone
-- queries it directly the second layer rule 3 asks for is simply absent.
--
-- Guard 02 enumerates the catalog rather than a list, so it found this rather than being
-- told about it. Every partition is therefore prepared by this function, which is also
-- what the worker calls to create next month's.
CREATE FUNCTION app.prepare_audit_partition(partition_name text) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', partition_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', partition_name);

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = partition_name AND policyname = 't_isolation'
  ) THEN
    EXECUTE format(
      'CREATE POLICY t_isolation ON public.%I USING (tenant_id = app.current_tenant())'
      ' WITH CHECK (tenant_id = app.current_tenant())',
      partition_name
    );
  END IF;

  EXECUTE format('GRANT SELECT, INSERT ON public.%I TO nx_app', partition_name);
  EXECUTE format('GRANT SELECT ON public.%I TO nx_retention', partition_name);
END;
$$;

-- Creates one month of audit log and prepares it. Called ahead of time by the worker.
CREATE FUNCTION app.create_audit_partition(month_start date) RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  partition_name text := 'audit_log_' || to_char(month_start, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.audit_log'
    ' FOR VALUES FROM (%L) TO (%L)',
    partition_name,
    month_start,
    (month_start + interval '1 month')::date
  );
  PERFORM app.prepare_audit_partition(partition_name);
  RETURN partition_name;
END;
$$;

REVOKE ALL ON FUNCTION app.prepare_audit_partition(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_audit_partition(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_audit_partition(date) TO nx_app;

-- The default partition catches anything the scheduled job has not covered yet. Losing
-- an audit row is worse than an untidy partition layout.
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;
SELECT app.prepare_audit_partition('audit_log_default');
SELECT app.create_audit_partition(date_trunc('month', now())::date);
SELECT app.create_audit_partition((date_trunc('month', now()) + interval '1 month')::date);
