-- 0045: a product knows which part of a customer file it fills.
--
-- The owner described the customer file as sections, each filled by one verification and
-- each with its own verify button: the basic registry data, the articles of association,
-- the authorised managers, the national address, the bank account, the freelance
-- certificate. A subscriber may tick all of them and verify once, or verify one section
-- on its own.
--
-- That is a property of the product, so it lives on the product row (rule 8). A product
-- added later as rows names its section and the kinds of customer it applies to, and the
-- file and the checklist show it without a line of interface code:
--
--   profile_section  which section of the file this product fills
--   applies_to       which kinds of customer it makes sense for: a company, a sole
--                    establishment, a freelancer. Articles of association exist for a
--                    company and not for an establishment, so the checklist of an
--                    establishment does not offer them.
--   check_order      the order sections appear in, and the order a full verification runs
--                    them in, so the registry is read before anything that depends on it
--   availability     AVAILABLE, or COMING_SOON for a product the data source documents but
--                    has not enabled on our account. Shown and never runnable, rather than
--                    hidden and then discovered.
--
-- A run also learns two things it did not record: who pressed the button, and which
-- verification a check belonged to when several were run together. The first is the
-- "performed by" line of the verification log. The second groups the checks of one full
-- verification, and is what makes a double click one set of charges rather than two:
-- each check's idempotency key is derived from it (rule 7).

SET LOCAL ROLE nx_migrator;

ALTER TABLE products
  ADD COLUMN profile_section text CHECK (
    profile_section IS NULL OR profile_section IN
      ('REGISTRY', 'CONTRACT', 'MANAGERS', 'ADDRESS', 'BANKING', 'FREELANCE', 'PROPERTY')
  ),
  ADD COLUMN applies_to text[] NOT NULL DEFAULT '{}' CHECK (
    applies_to <@ ARRAY['COMPANY', 'ESTABLISHMENT', 'FREELANCER']::text[]
  ),
  ADD COLUMN check_order int NOT NULL DEFAULT 100 CHECK (check_order >= 0),
  ADD COLUMN availability text NOT NULL DEFAULT 'AVAILABLE' CHECK (
    availability IN ('AVAILABLE', 'COMING_SOON')
  ),
  -- A product offered as a check names both, or neither.
  ADD CONSTRAINT ck_products_check_shape CHECK (
    (profile_section IS NULL) = (cardinality(applies_to) = 0)
  );

-- The panel marks a product available once the data source enables it, and retires one
-- nobody should buy. It changes nothing else about a product: what a product is stays a
-- seed, reviewed like code.
GRANT UPDATE (availability, status) ON products TO nx_operator;

ALTER TABLE verification_runs
  -- The person who pressed verify in the console. Null for the API, the monitor and a
  -- batch, which have no person behind them.
  ADD COLUMN requested_by uuid REFERENCES users(id),
  -- Shared by every check of one verification started together.
  ADD COLUMN bundle_key text CHECK (bundle_key IS NULL OR length(bundle_key) BETWEEN 8 AND 80);

CREATE INDEX ix_runs_bundle ON verification_runs (tenant_id, bundle_key) WHERE bundle_key IS NOT NULL;

-- Two roles a registry answer now fills. A partner named in the articles of association is
-- neither a manager nor an owner of a bank account, and the account an IBAN check confirms is
-- an entity of its own, so that the same IBAN presented for two customers resolves to one
-- account and the two customers become visibly linked.
ALTER TABLE step_field_map DROP CONSTRAINT step_field_map_entity_role_check;
ALTER TABLE step_field_map ADD CONSTRAINT step_field_map_entity_role_check CHECK (
  entity_role IN ('SUBJECT', 'MANAGER', 'OWNER', 'ACCOUNT_HOLDER', 'PROPERTY_OWNER', 'PARTNER', 'ACCOUNT')
);

-- How long the new facts stay current, as system defaults a subscriber may override.
--
-- The longest matching path wins (0016), so these sit under the rows that already exist:
-- cr.status keeps its seven days and cr.core its ninety, and everything else the registry
-- now returns falls under cr.
--
-- The table forces row level security and a default belongs to no tenant, so the force is
-- lifted for these inserts alone, inside this transaction, and put back.
ALTER TABLE freshness_policy NO FORCE ROW LEVEL SECURITY;
INSERT INTO freshness_policy (tenant_id, field_path, ttl_days, weight) VALUES
  (NULL, 'cr',          30, 10),
  (NULL, 'contract',   180,  8),
  (NULL, 'governance',          90, 10),
  (NULL, 'manager.positions',   90,  8),
  (NULL, 'manager.permissions', 90, 12),
  (NULL, 'partner',            180,  6),
  (NULL, 'ownership',          180,  4),
  (NULL, 'bank',                90, 12),
  (NULL, 'account',             90,  4),
  (NULL, 'person',             365,  2);
-- No row for freelance, as in 0007: the certificate carries its expiry from the authority,
-- and an estimate would be wrong wherever that date is present.
ALTER TABLE freshness_policy FORCE ROW LEVEL SECURITY;

-- What a change to the new facts means. Severity rules now match a path and everything
-- under it, so one rule on manager.permissions covers that manager in every company.
ALTER TABLE change_severity_rules NO FORCE ROW LEVEL SECURITY;
INSERT INTO change_severity_rules (tenant_id, field_path, from_value, to_value, severity, seq, reason_ar, reason_en) VALUES
  (NULL, 'cr.status_code', '1'::jsonb, NULL, 'CRITICAL', 12,
   'السجل التجاري لم يعد فعّالاً', 'The commercial registration is no longer active'),
  (NULL, 'cr.in_liquidation', NULL, 'true'::jsonb, 'CRITICAL', 14,
   'دخلت المنشأة في التصفية', 'The company entered liquidation'),
  (NULL, 'cr.kind', NULL, NULL, 'WARNING', 16,
   'تغيّر تصنيف المنشأة', 'The business classification changed'),
  (NULL, 'manager.permissions', NULL, NULL, 'WARNING', 22,
   'تغيّرت صلاحيات مدير مفوّض', 'An authorised manager''s powers changed'),
  (NULL, 'bank.iban_ownership', '"MATCH"'::jsonb, NULL, 'CRITICAL', 40,
   'لم يعد الحساب البنكي مطابقاً لصاحبه', 'The bank account no longer matches its holder'),
  (NULL, 'bank.account_status', '"ACTIVE"'::jsonb, NULL, 'WARNING', 42,
   'لم يعد الحساب البنكي نشطاً', 'The bank account is no longer active'),
  (NULL, 'freelance.certificate_status', '"ACTIVE"'::jsonb, NULL, 'CRITICAL', 32,
   'لم تعد وثيقة العمل الحر سارية', 'The freelance certificate is no longer active'),
  (NULL, 'address.national.key', NULL, NULL, 'WARNING', 50,
   'تغيّر العنوان الوطني', 'The national address changed');
ALTER TABLE change_severity_rules FORCE ROW LEVEL SECURITY;
