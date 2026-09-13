SET LOCAL ROLE nx_migrator;

ALTER TABLE change_severity_rules NO FORCE ROW LEVEL SECURITY;
DELETE FROM change_severity_rules WHERE tenant_id IS NULL AND field_path IN
  ('cr.status_code', 'cr.in_liquidation', 'cr.kind', 'manager.permissions', 'bank.iban_ownership',
   'bank.account_status', 'freelance.certificate_status', 'address.national.key');
ALTER TABLE change_severity_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE freshness_policy NO FORCE ROW LEVEL SECURITY;
DELETE FROM freshness_policy WHERE tenant_id IS NULL AND portfolio_id IS NULL AND field_path IN
  ('cr', 'contract', 'governance', 'manager.positions', 'manager.permissions', 'partner', 'ownership', 'bank', 'account', 'person');
ALTER TABLE freshness_policy FORCE ROW LEVEL SECURITY;

DELETE FROM step_field_map WHERE entity_role IN ('PARTNER', 'ACCOUNT');
ALTER TABLE step_field_map DROP CONSTRAINT step_field_map_entity_role_check;
ALTER TABLE step_field_map ADD CONSTRAINT step_field_map_entity_role_check CHECK (
  entity_role IN ('SUBJECT', 'MANAGER', 'OWNER', 'ACCOUNT_HOLDER', 'PROPERTY_OWNER')
);

DROP INDEX IF EXISTS ix_runs_bundle;

ALTER TABLE verification_runs
  DROP COLUMN IF EXISTS bundle_key,
  DROP COLUMN IF EXISTS requested_by;

REVOKE UPDATE (availability, status) ON products FROM nx_operator;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS ck_products_check_shape,
  DROP COLUMN IF EXISTS availability,
  DROP COLUMN IF EXISTS check_order,
  DROP COLUMN IF EXISTS applies_to,
  DROP COLUMN IF EXISTS profile_section;
