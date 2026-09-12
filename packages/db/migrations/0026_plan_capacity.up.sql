-- 0026: the three ways a plan can be sold, and capacity measured in transactions.
--
-- The plans so far measure what a subscriber gets in riyals of credit. A real quotation
-- measures it in transactions: up to three thousand verifications in a year, with a price
-- for anything past that. Both are needed, because they answer different questions. Credit
-- answers "what is this worth", capacity answers "how many may I run", and a customer
-- signs the second one.
--
-- Three sellable shapes, because that is what a buyer asks for and compares:
--   PAYG     no commitment, highest unit price
--   MONTHLY  a monthly minimum with a lower unit price
--   ANNUAL   a term commitment with the lowest unit price
--
-- A platform fee reappears here, at zero by default, and that is a deliberate fork rather
-- than a reversal of 0025. The blueprint says the platform carries no fee; a quotation may
-- still want to name one separately so the unit price does not have to absorb it. The
-- plan decides, the default follows the blueprint, and nothing in the code assumes either.

SET LOCAL ROLE nx_migrator;

ALTER TABLE packages
  ADD COLUMN billing_model text NOT NULL DEFAULT 'ANNUAL'
    CHECK (billing_model IN ('PAYG', 'MONTHLY', 'ANNUAL')),
  -- Capacity for the whole term. NULL means no count limit and the credit is the limit.
  ADD COLUMN included_transactions int
    CHECK (included_transactions IS NULL OR included_transactions > 0),
  -- A flat price for anything past the capacity. NULL defers to the price book, which is
  -- where a price that differs per product lives.
  ADD COLUMN overage_unit_halalas int
    CHECK (overage_unit_halalas IS NULL OR overage_unit_halalas >= 0),
  -- Named separately in an offer when the buyer wants to see what the platform costs.
  -- Zero by default, which is the blueprint's position.
  ADD COLUMN platform_fee_halalas int NOT NULL DEFAULT 0
    CHECK (platform_fee_halalas >= 0);

ALTER TABLE tenant_commitments
  -- Recorded on the commitment, so a plan edited next year does not change the capacity
  -- a customer signed for this year.
  ADD COLUMN included_transactions int
    CHECK (included_transactions IS NULL OR included_transactions > 0),
  ADD COLUMN transactions_used int NOT NULL DEFAULT 0 CHECK (transactions_used >= 0),
  ADD COLUMN platform_fee_halalas int NOT NULL DEFAULT 0
    CHECK (platform_fee_halalas >= 0);

COMMENT ON COLUMN packages.credit_rollover_days IS
  'Days unused credit survives past the term. Zero means it expires with the term, which is what a capacity package sells.';

-- The application counts transactions and changes nothing else on the commitment.
--
-- A column level grant rather than UPDATE on the table, for the same reason the
-- attestations table has one: the row carries what a customer signed for, and an
-- application that can increment a counter must not also be able to move that customer
-- onto another plan. The policy already limits it to its own row; this limits it to two
-- columns of that row.
GRANT UPDATE (transactions_used, updated_at) ON tenant_commitments TO nx_app;
