-- Undo 0065. The rate goes back to being read live from the plan, which means editing a plan
-- reprices existing subscribers' past excess runs again.

SET LOCAL ROLE nx_migrator;

ALTER TABLE tenant_commitments DROP COLUMN IF EXISTS overage_unit_halalas;
