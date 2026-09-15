-- 0048: everything a registry answer says, and the people it names besides managers and partners.
--
-- The owner asked for every field the data source returns on the customer file. Most of that
-- is rows in step_field_map and needs nothing here. Three kinds of thing do.
--
-- Roles and relations a registry answer now fills. A company in liquidation names its
-- liquidators, a minor partner acts through a guardian, and a branch names the main
-- registration it belongs to. Each is somebody or something of its own, resolved by its
-- identifier and linked to the company, exactly as a manager is: LIQUIDATES from the company to
-- its liquidator, REPRESENTS from the company to a guardian, BRANCH_OF from a branch to its
-- main registration.
--
-- An identity of a kind we did not model. A partner may be an endowment identified by its
-- deed, a government body by its licence, a person by a passport or a Gulf ID. They were
-- counted and dropped, because typing one as a national ID would merge two different parties
-- that share digits. PARTY_ID keeps them, hashed and encrypted like every identifier (rule 4),
-- under a type of its own, so a deed number never matches a national ID or a registration.
--
-- How long the new facts stay current, as system defaults a subscriber may override.

SET LOCAL ROLE nx_migrator;

ALTER TABLE step_field_map DROP CONSTRAINT step_field_map_entity_role_check;
ALTER TABLE step_field_map ADD CONSTRAINT step_field_map_entity_role_check CHECK (
  entity_role IN ('SUBJECT', 'MANAGER', 'OWNER', 'ACCOUNT_HOLDER', 'PROPERTY_OWNER', 'PARTNER',
                  'ACCOUNT', 'LIQUIDATOR', 'GUARDIAN', 'MAIN_REGISTRY')
);

ALTER TABLE step_field_map DROP CONSTRAINT step_field_map_relation_type_check;
ALTER TABLE step_field_map ADD CONSTRAINT step_field_map_relation_type_check CHECK (
  relation_type IS NULL OR
  relation_type IN ('MANAGES', 'OWNS', 'HOLDS_ACCOUNT', 'OWNS_PROPERTY', 'SHARES_ADDRESS',
                    'LIQUIDATES', 'REPRESENTS', 'BRANCH_OF')
);

ALTER TABLE entity_relations DROP CONSTRAINT entity_relations_rel_type_check;
ALTER TABLE entity_relations ADD CONSTRAINT entity_relations_rel_type_check CHECK (
  rel_type IN ('MANAGES', 'OWNS', 'HOLDS_ACCOUNT', 'OWNS_PROPERTY', 'SHARES_ADDRESS',
               'LIQUIDATES', 'REPRESENTS', 'BRANCH_OF')
);

ALTER TABLE entity_identifiers DROP CONSTRAINT ck_entity_identifiers_type;
ALTER TABLE entity_identifiers ADD CONSTRAINT ck_entity_identifiers_type CHECK (
  id_type IN ('CR', 'UNN', 'NATIONAL_ID', 'IQAMA', 'FREELANCE_DOC', 'IBAN', 'REAL_ESTATE_NO',
              'PARTY_ID')
);

-- The longest matching path wins (0016), so manager.positions and manager.permissions keep
-- their own rows and only the rest of what is true of a manager falls under manager.
ALTER TABLE freshness_policy NO FORCE ROW LEVEL SECURITY;
INSERT INTO freshness_policy (tenant_id, field_path, ttl_days, weight) VALUES
  (NULL, 'manager',     90, 4),
  (NULL, 'liquidator',  30, 6),
  (NULL, 'guardian',   180, 2),
  (NULL, 'party',      365, 2),
  (NULL, 'registry',    30, 4);
ALTER TABLE freshness_policy FORCE ROW LEVEL SECURITY;

-- A liquidator appearing is worth telling somebody about, whatever the status text says.
ALTER TABLE change_severity_rules NO FORCE ROW LEVEL SECURITY;
INSERT INTO change_severity_rules (tenant_id, field_path, from_value, to_value, severity, seq, reason_ar, reason_en) VALUES
  (NULL, 'cr.liquidators_total', NULL, NULL, 'WARNING', 15,
   'تغيّر المصفّون المسجلون للمنشأة', 'The registered liquidators changed');
ALTER TABLE change_severity_rules FORCE ROW LEVEL SECURITY;
