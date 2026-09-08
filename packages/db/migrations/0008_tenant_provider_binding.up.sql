-- 0008: which provider a tenant uses, under whose account, with which credential.
--
-- ADR-005: mode lives on (tenant, provider), never on the tenant. One customer can be
-- BYOC with one provider and MANAGED with another, and the upgrade is one row.
--
-- Rule 10: credential_ref is a pointer into the KMS. No credential is stored here, in a
-- backup of this database, or in a log line. The column is deliberately too small and too
-- plain to tempt anyone into putting a secret in it, and the check constraint below
-- refuses the shapes a secret usually takes.

SET LOCAL ROLE nx_migrator;

CREATE TABLE tenant_provider_binding (
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  provider       text NOT NULL,
  mode           text NOT NULL CHECK (mode IN ('MANAGED', 'BYOC')),
  credential_ref text,
  rate_limit_rps int  NOT NULL DEFAULT 5,
  health_status  text NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('unknown', 'healthy', 'degraded', 'down')),
  last_tested_at timestamptz,
  activated_at   timestamptz,
  PRIMARY KEY (tenant_id, provider),
  CONSTRAINT ck_binding_rate_limit CHECK (rate_limit_rps > 0),
  -- A reference, not a value. Anything long enough to be a key is refused outright.
  CONSTRAINT ck_credential_is_a_reference CHECK (
    credential_ref IS NULL OR (length(credential_ref) <= 200 AND credential_ref LIKE 'kms://%')
  )
);

CREATE INDEX ix_binding_provider ON tenant_provider_binding (provider, health_status);

ALTER TABLE tenant_provider_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_provider_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON tenant_provider_binding
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON tenant_provider_binding TO nx_app;
GRANT SELECT ON tenant_provider_binding TO nx_retention;
