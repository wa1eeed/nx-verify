SET LOCAL ROLE nx_migrator;

DELETE FROM product_provider_routing WHERE product_code = 'INCOME_VERIFICATION';

UPDATE products
   SET profile_section = NULL,
       applies_to      = ARRAY[]::text[],
       check_order     = 100,
       availability    = 'AVAILABLE'
 WHERE code = 'INCOME_VERIFICATION';

DELETE FROM section_requirements WHERE section = 'INCOME';

ALTER TABLE section_requirements DROP CONSTRAINT IF EXISTS ck_section_requirements_section;
ALTER TABLE section_requirements ADD CONSTRAINT ck_section_requirements_section CHECK (
  section IN ('REGISTRY', 'CONTRACT', 'MANAGERS', 'ADDRESS', 'BANKING', 'FREELANCE', 'PROPERTY')
);

ALTER TABLE products DROP CONSTRAINT IF EXISTS ck_products_profile_section;
ALTER TABLE products ADD CONSTRAINT ck_products_profile_section CHECK (
  profile_section IS NULL OR profile_section IN
    ('REGISTRY', 'CONTRACT', 'MANAGERS', 'ADDRESS', 'BANKING', 'FREELANCE', 'PROPERTY')
);

ALTER TABLE products DROP COLUMN IF EXISTS module_code;

DROP TABLE IF EXISTS tenant_modules;
DROP TABLE IF EXISTS modules;
