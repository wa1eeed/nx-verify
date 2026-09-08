-- 0005: identifiers, stored twice and never in the clear.
--
-- Rule 4: no national id or personal identifier is stored as text. The hash is an
-- HMAC-SHA256 under a key derived per tenant, and it is what lookup, matching and
-- indexing use. The encrypted column is what display reads. Neither is reversible by
-- anyone holding only the database.
--
-- Because the hash is keyed per tenant, the same national id produces a different hash
-- for every tenant. Correlating a person across tenants is impossible even for someone
-- holding the whole table, which is the technical half of the contractual promise in
-- docs/01-blueprint.md section 11.

SET LOCAL ROLE nx_migrator;

CREATE TABLE entity_identifiers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  entity_id     uuid NOT NULL,
  id_type       text NOT NULL,
  id_value_hash bytea NOT NULL,
  id_value_enc  bytea NOT NULL,
  is_primary    boolean NOT NULL DEFAULT false,
  CONSTRAINT fk_entity_identifiers_entity
    FOREIGN KEY (tenant_id, entity_id) REFERENCES entities (tenant_id, id),
  CONSTRAINT ck_entity_identifiers_type CHECK (
    id_type IN ('CR', 'UNN', 'NATIONAL_ID', 'IQAMA', 'FREELANCE_DOC', 'IBAN', 'REAL_ESTATE_NO')
  ),
  -- A 32 byte HMAC-SHA256 digest, nothing else.
  CONSTRAINT ck_entity_identifiers_hash_length CHECK (octet_length(id_value_hash) = 32)
);

-- Identity resolution depends on this index. An identifier that matches an existing
-- entity for the same tenant is merged into it, never duplicated.
CREATE UNIQUE INDEX uq_ident
  ON entity_identifiers (tenant_id, id_type, id_value_hash);

CREATE INDEX ix_ident_entity ON entity_identifiers (tenant_id, entity_id);

-- At most one primary identifier per entity.
CREATE UNIQUE INDEX uq_ident_primary
  ON entity_identifiers (tenant_id, entity_id)
  WHERE is_primary;

ALTER TABLE entity_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_identifiers FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON entity_identifiers
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON entity_identifiers TO nx_app;
GRANT SELECT ON entity_identifiers TO nx_retention;
