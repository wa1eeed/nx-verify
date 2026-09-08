-- 0002: the minimal chain of tenant scoped tables.
--
-- Scope note: the build order places these tables in unit 1, but guards 01 and 02 are
-- acceptance criteria for unit 0 and cannot be written against a schema that does not
-- exist. Unit 0 therefore creates the structure only. No repository, no service and no
-- domain logic accompanies it. entity_identifiers, the profile view and the freshness
-- policy stay in unit 1.
--
-- Composite foreign keys carry the tenant_id into every reference. A row can only point
-- at a row belonging to the same tenant, which makes a cross tenant reference impossible
-- at the storage layer rather than merely unlikely in the query layer.

SET LOCAL ROLE nx_migrator;

CREATE TABLE tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name      text NOT NULL,
  cr_number       text,
  status          text NOT NULL DEFAULT 'active',
  data_region     text NOT NULL DEFAULT 'ksa',
  retention_days  int  NOT NULL DEFAULT 1825,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  entity_type   text NOT NULL,
  display_name  text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,
  CONSTRAINT uq_entities_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT ck_entities_type CHECK (
    entity_type IN ('BUSINESS', 'PERSON', 'FREELANCER', 'BANK_ACCOUNT', 'PROPERTY')
  )
);

CREATE INDEX ix_entities_tenant ON entities (tenant_id, entity_type);

CREATE TABLE attestations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  entity_id     uuid NOT NULL,
  field_path    text NOT NULL,
  value         jsonb NOT NULL,
  value_hash    bytea NOT NULL,
  source        text NOT NULL,
  authority     text,
  run_id        uuid NOT NULL,
  observed_at   timestamptz NOT NULL,
  valid_from    timestamptz NOT NULL,
  valid_until   timestamptz,
  confidence    numeric(4,3) NOT NULL DEFAULT 1.000,
  superseded_by uuid,
  evidence_id   uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_attestations_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_attestations_entity
    FOREIGN KEY (tenant_id, entity_id) REFERENCES entities (tenant_id, id),
  CONSTRAINT fk_attestations_superseded_by
    FOREIGN KEY (tenant_id, superseded_by) REFERENCES attestations (tenant_id, id),
  CONSTRAINT ck_attestations_not_self_superseded CHECK (superseded_by IS DISTINCT FROM id),
  CONSTRAINT ck_attestations_confidence CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX ix_att_latest
  ON attestations (tenant_id, entity_id, field_path, observed_at DESC);

CREATE INDEX ix_att_expiry
  ON attestations (tenant_id, valid_until)
  WHERE superseded_by IS NULL;
