-- 0051: modules. What a subscriber buys, what a customer file draws, and one switch for both.
--
-- Turning a verification off for one subscriber has existed since 0024, at the level of one
-- product code. Two things were wrong with that as the only handle.
--
-- The first is arithmetic. The layout of a customer file comes from section_requirements,
-- which knows nothing about any subscriber. So switching NATIONAL_ADDRESS off for a company
-- subscriber left the ADDRESS section in every one of their files, REQUIRED, with no check to
-- fill it and no button to press: completeness capped at 80 per cent for ever, and the standing
-- score lowered with it. The subscriber was punished for a service they did not buy.
--
-- The second is that a product code is not what anybody sells. Income verification is one
-- product today and will be three (income, affordability, statement). Sold by code, the owner
-- has to remember which codes travel together. Sold by module, the switch stays one switch.
--
-- So: a module is a named group of verification products that fills one section of a customer
-- file. Products belong to a module. A subscriber has the module or does not, and when they do
-- not the section is not drawn, not required, and not counted against them.
--
-- The cascade, most specific first, is unchanged in spirit and gains one rung:
--
--   tenant_product_overrides.enabled   one product for one subscriber, the scalpel
--   tenant_modules.enabled             the module for one subscriber, the switch
--   package_products.enabled           what their plan sells
--   modules.default_on                 what a module is worth to somebody with no plan yet
--
-- A core module is not on the switch at all: without the commercial registration there is no
-- customer file to draw, so REGISTRY answers true whatever anybody writes.
--
-- Rule 8 holds: a module is rows. Rule 3 holds: tenant_modules carries tenant_id and forces
-- row level security. Rule 5 is untouched, no provider is named here.

SET LOCAL ROLE nx_migrator;

-- ── the modules ───────────────────────────────────────────────────────────────────────────

CREATE TABLE modules (
  code       text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  name_ar    text NOT NULL CHECK (length(name_ar) BETWEEN 2 AND 60),
  name_en    text NOT NULL CHECK (length(name_en) BETWEEN 2 AND 60),
  -- One line, shown on the panel and beside the switch, so the person deciding reads what the
  -- subscriber will gain or lose rather than a product code.
  summary_ar text NOT NULL CHECK (length(summary_ar) BETWEEN 2 AND 240),
  -- The section of a customer file this module fills. Unique: a section is drawn by exactly
  -- one module, which is what makes «the section disappears» a well defined sentence. NULL is
  -- a module sold only through the API, which draws nothing.
  section    text UNIQUE CHECK (
    section IN ('REGISTRY', 'CONTRACT', 'MANAGERS', 'ADDRESS', 'BANKING', 'FREELANCE',
                'PROPERTY', 'INCOME')
  ),
  position   int NOT NULL CHECK (position > 0),
  -- A module that cannot be switched off, because the file cannot be drawn without it.
  core       boolean NOT NULL DEFAULT false,
  -- What a subscriber gets when nobody has decided: their plan speaks first, and this answers
  -- when even the plan is silent. Off for anything needing a contract or a consent flow.
  default_on boolean NOT NULL DEFAULT true,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  -- A core module answers true for everybody, so an off default would be a contradiction.
  CONSTRAINT ck_modules_core_is_on CHECK (NOT core OR default_on)
);

COMMENT ON TABLE modules IS
  'A named group of verification products that fills one section of a customer file. The unit a subscriber buys and the unit staff switch.';
COMMENT ON COLUMN modules.core IS
  'Cannot be switched off for anybody: the file cannot be drawn without it.';

REVOKE ALL ON modules FROM PUBLIC;
GRANT SELECT ON modules TO nx_app, nx_retention;
GRANT SELECT, INSERT, UPDATE ON modules TO nx_operator;

-- ── every product belongs to one ──────────────────────────────────────────────────────────

ALTER TABLE products ADD COLUMN module_code text REFERENCES modules (code);
COMMENT ON COLUMN products.module_code IS
  'The module that sells this product. A product outside every module could never be switched on or off.';

-- ── the switch, per subscriber ────────────────────────────────────────────────────────────

CREATE TABLE tenant_modules (
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  module_code text NOT NULL REFERENCES modules (code) ON DELETE CASCADE,
  enabled     boolean NOT NULL,
  -- Who decided and when: switching a module on is a commercial act, and a year later
  -- somebody asks who agreed to it.
  decided_at  timestamptz NOT NULL DEFAULT now(),
  decided_by  text,
  note        text CHECK (note IS NULL OR length(note) <= 200),
  PRIMARY KEY (tenant_id, module_code)
);

COMMENT ON TABLE tenant_modules IS
  'Which modules one subscriber has. Beats their plan, and is beaten by an exception written for a single product.';

ALTER TABLE tenant_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_modules FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON tenant_modules
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

REVOKE ALL ON tenant_modules FROM PUBLIC;
-- The application reads its own row to know what to draw. Only staff decide.
GRANT SELECT ON tenant_modules TO nx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_modules TO nx_operator;
CREATE POLICY operator_manage ON tenant_modules
  TO nx_operator
  USING (true)
  WITH CHECK (true);

-- ── the income section ────────────────────────────────────────────────────────────────────
--
-- The check constraint on section_requirements.section was written in 0047 with seven names in
-- it. Its name was generated, so it is found rather than guessed.

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO STRICT constraint_name
    FROM pg_constraint
   WHERE conrelid = 'section_requirements'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%REGISTRY%';
  EXECUTE format('ALTER TABLE section_requirements DROP CONSTRAINT %I', constraint_name);
END $$;

ALTER TABLE section_requirements ADD CONSTRAINT ck_section_requirements_section CHECK (
  section IN ('REGISTRY', 'CONTRACT', 'MANAGERS', 'ADDRESS', 'BANKING', 'FREELANCE',
              'PROPERTY', 'INCOME')
);

-- The same list is written a second time on products.profile_section (0045). Widened the same
-- way, and found the same way, because that one's name was generated too.
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO STRICT constraint_name
    FROM pg_constraint
   WHERE conrelid = 'products'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%profile_section%'
     AND pg_get_constraintdef(oid) LIKE '%REGISTRY%';
  EXECUTE format('ALTER TABLE products DROP CONSTRAINT %I', constraint_name);
END $$;

ALTER TABLE products ADD CONSTRAINT ck_products_profile_section CHECK (
  profile_section IS NULL OR profile_section IN
    ('REGISTRY', 'CONTRACT', 'MANAGERS', 'ADDRESS', 'BANKING', 'FREELANCE', 'PROPERTY', 'INCOME')
);

-- ── the eight modules at launch ───────────────────────────────────────────────────────────

INSERT INTO modules (code, name_ar, name_en, summary_ar, section, position, core, default_on) VALUES
  ('REGISTRY', 'السجل التجاري', 'Commercial registry',
   'بيانات المنشأة كما تقولها الجهة: الاسم والحالة والنشاط والملاك. أساس كل ملف عميل ولا يُطفأ.',
   'REGISTRY', 1, true, true),
  ('CONTRACT', 'عقد التأسيس', 'Articles of association',
   'عقد تأسيس الشركة: حصص الشركاء، ومن يملك التوقيع، وحدود ما يملكه.',
   'CONTRACT', 2, false, true),
  ('MANAGERS', 'المدراء والصلاحيات', 'Managers and authority',
   'المدراء المفوضون وصلاحيات كل واحد منهم، بنداء مستقل لكل مدير.',
   'MANAGERS', 3, false, true),
  ('ADDRESS', 'العنوان الوطني', 'National address',
   'العنوان الوطني المسجّل للمنشأة كما هو لدى الجهة.',
   'ADDRESS', 4, false, true),
  ('BANKING', 'الحساب البنكي', 'Bank account',
   'الآيبان وصاحب الحساب ومطابقة الاسم مع اسم المنشأة.',
   'BANKING', 5, false, true),
  ('FREELANCE', 'العمل الحر', 'Freelance permit',
   'وثيقة العمل الحر: رقمها وتخصصها وحالتها ومدتها.',
   'FREELANCE', 6, false, true),
  -- Off by default: most customers own no property, and the service is not open at the source
  -- yet. A subscriber who asks for it is switched on deliberately.
  ('PROPERTY', 'العقار', 'Property',
   'الصك العقاري: رقمه ومالكه ووصف العقار ومساحته.',
   'PROPERTY', 7, false, false),
  -- Off by default and for a harder reason: income is read from the customer's own bank
  -- account, which needs that customer's consent. Nobody is given it without asking.
  ('INCOME', 'الدخل', 'Income',
   'الدخل من الحساب البنكي بموافقة صاحبه: متوسطه الشهري، ومصادره، وثباته عبر الأشهر.',
   'INCOME', 8, false, false);

-- ── which module sells which product ──────────────────────────────────────────────────────
--
-- Each API product joins the module of the file check that asks the same question, so one
-- switch is true everywhere: switch the income module off and it leaves the file and the API
-- together, rather than leaving a screen while the endpoint keeps answering.

UPDATE products SET module_code = m.code FROM (VALUES
  ('CR_FULL', 'REGISTRY'),
  ('KYB_COMPLETE', 'REGISTRY'),
  ('ARTICLES_OF_ASSOCIATION', 'CONTRACT'),
  ('AOA_ONLY', 'CONTRACT'),
  ('MANAGER_AUTHORITY', 'MANAGERS'),
  ('MANAGER_PERMISSIONS', 'MANAGERS'),
  ('NATIONAL_ADDRESS', 'ADDRESS'),
  ('ADDRESS_ONLY', 'ADDRESS'),
  ('IBAN_VERIFICATION', 'BANKING'),
  ('IBAN_BENEFICIARY_NAME', 'BANKING'),
  ('IBAN_OWNERSHIP', 'BANKING'),
  ('BANK_ACCOUNT_OWNERSHIP', 'BANKING'),
  ('NAME_MATCH', 'BANKING'),
  ('FREELANCE_CERTIFICATE', 'FREELANCE'),
  ('FREELANCER_CERTIFICATE', 'FREELANCE'),
  ('PROPERTY_VERIFICATION', 'PROPERTY'),
  ('PROPERTY_DEED', 'PROPERTY'),
  ('INCOME_VERIFICATION', 'INCOME')
) AS m (product, code)
WHERE products.code = m.product;

-- Anything the mapping above missed falls to the registry module rather than out of every
-- module, because a product nobody can switch is a product nobody can sell.
UPDATE products SET module_code = 'REGISTRY' WHERE module_code IS NULL;
ALTER TABLE products ALTER COLUMN module_code SET NOT NULL;

-- ── income verification finds its place in the file ────────────────────────────────────────
--
-- INCOME_VERIFICATION has been in the catalogue since the first seed, sold through the API and
-- drawn nowhere, exactly as the property check was before 0050.
--
-- It belongs to the individuals' side of the file, not to companies. A company's income is
-- revenue, read from statements and filings, and that is a different product with a different
-- authority. An establishment and a freelancer are natural persons with a personal account,
-- and that account is what this reads.
--
-- It stays COMING_SOON because it cannot run without the customer's own consent to open their
-- account, and no consent flow is built. Showing it as runnable would be a promise the
-- platform cannot keep.
UPDATE products
   SET profile_section = 'INCOME',
       applies_to      = ARRAY['ESTABLISHMENT', 'FREELANCER'],
       check_order     = 60,
       availability    = 'COMING_SOON',
       summary_ar      = 'متوسط الدخل الشهري ومصادره وثباته، من الحساب البنكي بموافقة صاحبه.'
 WHERE code = 'INCOME_VERIFICATION';

-- OPTIONAL for both: a file is not incomplete because nobody asked its owner for the consent
-- to read their account. And no row at all for a company, rather than one saying «not
-- applicable»: a freelancer's file says its address cannot be verified because somebody would
-- otherwise look for it, and nobody opens a company file looking for a salary.
INSERT INTO section_requirements (kind, section, requirement, position) VALUES
  ('ESTABLISHMENT', 'INCOME', 'OPTIONAL', 6),
  ('FREELANCER', 'INCOME', 'OPTIONAL', 6)
ON CONFLICT (kind, section) DO NOTHING;

-- The primary data source reads income from a linked account, so it serves this service from
-- the day the consent flow exists. Routed explicitly (0050) rather than left to the provider
-- the step declares, so the panel shows the service with a provider on it and the margin is
-- computed against whoever will really take the call.
INSERT INTO product_provider_routing (product_code, provider, priority, status, updated_by)
SELECT 'INCOME_VERIFICATION', p.code, 1, 'active', 'migration:0051'
  FROM provider_catalog p
 WHERE p.code = 'lean' AND 'income_verification' = ANY (p.endpoints)
ON CONFLICT (product_code, provider) DO NOTHING;

RESET ROLE;
