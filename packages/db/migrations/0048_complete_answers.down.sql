SET LOCAL ROLE nx_migrator;

ALTER TABLE change_severity_rules NO FORCE ROW LEVEL SECURITY;
DELETE FROM change_severity_rules WHERE tenant_id IS NULL AND field_path = 'cr.liquidators_total';
ALTER TABLE change_severity_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE freshness_policy NO FORCE ROW LEVEL SECURITY;
DELETE FROM freshness_policy WHERE tenant_id IS NULL AND portfolio_id IS NULL AND field_path IN
  ('manager', 'liquidator', 'guardian', 'party', 'registry');
ALTER TABLE freshness_policy FORCE ROW LEVEL SECURITY;

-- Both tables force row level security, so the rows of the new kinds are removed across every
-- tenant with the force lifted for this transaction alone, and put back.
ALTER TABLE entity_identifiers NO FORCE ROW LEVEL SECURITY;
DELETE FROM entity_identifiers WHERE id_type = 'PARTY_ID';
ALTER TABLE entity_identifiers FORCE ROW LEVEL SECURITY;
ALTER TABLE entity_identifiers DROP CONSTRAINT ck_entity_identifiers_type;
ALTER TABLE entity_identifiers ADD CONSTRAINT ck_entity_identifiers_type CHECK (
  id_type IN ('CR', 'UNN', 'NATIONAL_ID', 'IQAMA', 'FREELANCE_DOC', 'IBAN', 'REAL_ESTATE_NO')
);

ALTER TABLE entity_relations NO FORCE ROW LEVEL SECURITY;
DELETE FROM entity_relations WHERE rel_type IN ('LIQUIDATES', 'REPRESENTS', 'BRANCH_OF');
ALTER TABLE entity_relations FORCE ROW LEVEL SECURITY;
ALTER TABLE entity_relations DROP CONSTRAINT entity_relations_rel_type_check;
ALTER TABLE entity_relations ADD CONSTRAINT entity_relations_rel_type_check CHECK (
  rel_type IN ('MANAGES', 'OWNS', 'HOLDS_ACCOUNT', 'OWNS_PROPERTY', 'SHARES_ADDRESS')
);

DELETE FROM step_field_map
WHERE entity_role IN ('LIQUIDATOR', 'GUARDIAN', 'MAIN_REGISTRY')
   OR relation_type IN ('LIQUIDATES', 'REPRESENTS', 'BRANCH_OF');
ALTER TABLE step_field_map DROP CONSTRAINT step_field_map_relation_type_check;
ALTER TABLE step_field_map ADD CONSTRAINT step_field_map_relation_type_check CHECK (
  relation_type IS NULL OR
  relation_type IN ('MANAGES', 'OWNS', 'HOLDS_ACCOUNT', 'OWNS_PROPERTY', 'SHARES_ADDRESS')
);
ALTER TABLE step_field_map DROP CONSTRAINT step_field_map_entity_role_check;
ALTER TABLE step_field_map ADD CONSTRAINT step_field_map_entity_role_check CHECK (
  entity_role IN ('SUBJECT', 'MANAGER', 'OWNER', 'ACCOUNT_HOLDER', 'PROPERTY_OWNER', 'PARTNER', 'ACCOUNT')
);
