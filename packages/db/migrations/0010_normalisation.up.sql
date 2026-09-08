-- 0010: turning a provider payload into attestations, entities and relations.
--
-- ADR-003 and rule 8. This table is what makes a new product rows rather than code. Not
-- one line anywhere maps a provider field to one of ours; these rows do it.
--
-- Two deliberate departures from docs/03-products.md section 3.
--
-- ttl_override is not implemented. Writing a per mapping TTL onto the attestation would
-- freeze that field's lifetime at whatever the product definition said on the day it was
-- written, which is exactly what ADR-013 removed. A field's lifetime belongs in
-- freshness_policy, which already resolves at three levels and takes effect immediately.
-- See ADR-017.
--
-- Three columns are added. identifier_type_source, because identifier_path alone cannot
-- say whether a string of digits is a commercial registration or a national id, and
-- getting that wrong merges two different people. valid_until_path, for a real expiry
-- printed in the payload, such as the one on a freelance document. And confidence, since
-- a name match is not the same evidence as an identifier match.

SET LOCAL ROLE nx_migrator;

CREATE TABLE step_field_map (
  product_code           text NOT NULL,
  step_key               text NOT NULL,
  -- Path into the provider payload. May contain one [*] wildcard to walk an array,
  -- in which case @.<path> reads a field of the current element.
  source_path            text NOT NULL,
  field_path             text NOT NULL,
  entity_role            text NOT NULL DEFAULT 'SUBJECT' CHECK (
    entity_role IN ('SUBJECT', 'MANAGER', 'OWNER', 'ACCOUNT_HOLDER', 'PROPERTY_OWNER')
  ),
  entity_type            text CHECK (
    entity_type IS NULL OR
    entity_type IN ('BUSINESS', 'PERSON', 'FREELANCER', 'BANK_ACCOUNT', 'PROPERTY')
  ),
  -- Which value resolves the secondary entity. This is what stops the same manager
  -- being created ten times.
  identifier_path        text,
  identifier_type_source text,
  relation_type          text CHECK (
    relation_type IS NULL OR
    relation_type IN ('MANAGES', 'OWNS', 'HOLDS_ACCOUNT', 'OWNS_PROPERTY', 'SHARES_ADDRESS')
  ),
  valid_until_path       text,
  confidence             numeric(4,3) NOT NULL DEFAULT 1.000,
  PRIMARY KEY (product_code, step_key, source_path),
  CONSTRAINT fk_step_field_map_step
    FOREIGN KEY (product_code, step_key) REFERENCES product_steps (product_code, step_key)
    ON DELETE CASCADE,
  -- A secondary entity is unresolvable without an identifier, and creating one without
  -- resolution is how duplicates get in.
  CONSTRAINT ck_secondary_entity_is_resolvable CHECK (
    entity_role = 'SUBJECT' OR (identifier_path IS NOT NULL AND entity_type IS NOT NULL)
  ),
  CONSTRAINT ck_confidence_range CHECK (confidence > 0 AND confidence <= 1)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON step_field_map TO nx_app;
GRANT SELECT ON step_field_map TO nx_retention;

CREATE TABLE entity_relations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  from_entity    uuid NOT NULL,
  to_entity      uuid NOT NULL,
  rel_type       text NOT NULL CHECK (
    rel_type IN ('MANAGES', 'OWNS', 'HOLDS_ACCOUNT', 'OWNS_PROPERTY', 'SHARES_ADDRESS')
  ),
  attributes     jsonb,
  -- Rule 5 of the schema principles: every derived row points at the attestation that
  -- produced it.
  attestation_id uuid NOT NULL,
  valid_from     timestamptz NOT NULL,
  valid_until    timestamptz,
  -- A relation is never deleted. When the authorised manager changes, the old relation
  -- is ended and a new one begins, and the history survives.
  ended_at       timestamptz,
  CONSTRAINT fk_relations_from FOREIGN KEY (tenant_id, from_entity) REFERENCES entities (tenant_id, id),
  CONSTRAINT fk_relations_to FOREIGN KEY (tenant_id, to_entity) REFERENCES entities (tenant_id, id),
  CONSTRAINT fk_relations_attestation
    FOREIGN KEY (tenant_id, attestation_id) REFERENCES attestations (tenant_id, id),
  CONSTRAINT ck_relation_not_self CHECK (from_entity <> to_entity)
);

CREATE INDEX ix_rel_to ON entity_relations (tenant_id, to_entity, rel_type)
  WHERE ended_at IS NULL;

CREATE INDEX ix_rel_from ON entity_relations (tenant_id, from_entity, rel_type)
  WHERE ended_at IS NULL;

-- One live relation of a kind between two entities. A re-verification that finds the
-- same manager must not stack a second row.
CREATE UNIQUE INDEX uq_rel_live
  ON entity_relations (tenant_id, from_entity, to_entity, rel_type)
  WHERE ended_at IS NULL;

ALTER TABLE entity_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_relations FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON entity_relations
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON entity_relations TO nx_app;
GRANT SELECT ON entity_relations TO nx_retention;
