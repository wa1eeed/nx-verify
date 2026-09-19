-- 0065: the overage rate a customer signed for, recorded on their commitment.
--
-- Migration 0026 copied `included_transactions` onto `tenant_commitments` and said why in a
-- comment that is still on the column: a plan edited next year must not change the capacity a
-- customer signed for this year. It did not copy the overage rate, because at the time nothing
-- charged it.
--
-- Something does now (ADR-167), so the rate is read live from `packages` while the capacity it
-- applies past is read from the commitment. Editing a plan's overage price in the panel
-- therefore reprices every existing subscriber's excess runs, backwards, for runs already
-- taken. The same argument that put the capacity here puts the rate here.
--
-- Backfilled from the plan each commitment is on, which is the rate those subscribers have in
-- fact been charged since the day it began being charged. Null stays null: a plan with no
-- overage rate defers to the price book and always did.

SET LOCAL ROLE nx_migrator;

ALTER TABLE tenant_commitments
  -- The flat rate for anything past the capacity, as it stood when this commitment was made.
  -- NULL defers to the price book, which is where a price that differs per product lives.
  ADD COLUMN overage_unit_halalas int
    CHECK (overage_unit_halalas IS NULL OR overage_unit_halalas >= 0);

UPDATE tenant_commitments c
   SET overage_unit_halalas = p.overage_unit_halalas
  FROM packages p
 WHERE p.code = c.package_code;

COMMENT ON COLUMN tenant_commitments.overage_unit_halalas IS
  'The overage rate this customer signed for. Read in preference to packages.overage_unit_halalas so a plan edited later cannot reprice runs already taken.';
