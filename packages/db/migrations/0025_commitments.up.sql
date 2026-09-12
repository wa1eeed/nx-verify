-- 0025: the commercial model the blueprint actually describes.
--
-- 0024 built packages as a monthly subscription with a platform fee. docs/01-blueprint.md
-- section 9 describes something different and says so in its first line: do not call it a
-- subscription. It is an annual commitment drawn down by usage, where the platform, the
-- console, the audit trail, the evidence and support carry no fee at all, overage is
-- billed at the same unit prices, and unused credit carries for ninety days.
--
-- The revenue components there are six, and three of them were missing entirely: the
-- setup fee, waived at a twenty four month commitment; seats, which are what makes
-- revenue grow without consumption growing; and active portfolios. Two competitive
-- practices from the same section are commercial rules rather than marketing, and they
-- belong in the plan: no charge for re-verifying the same entity within thirty days, and
-- a paid trial that is deducted from the contract.
--
-- A package is therefore a plan template: it names a term, the credit that term grants,
-- what is included before extras are charged, and which verification modules it turns on.

SET LOCAL ROLE nx_migrator;

ALTER TABLE packages
  DROP COLUMN monthly_fee_halalas,
  DROP COLUMN included_credits_halalas,
  -- The commitment. Twelve months by default, twenty four for the customers who want the
  -- setup fee waived and the price held.
  ADD COLUMN term_months int NOT NULL DEFAULT 12 CHECK (term_months IN (3, 12, 24)),
  ADD COLUMN commitment_credits_halalas int NOT NULL DEFAULT 0
    CHECK (commitment_credits_halalas >= 0),
  ADD COLUMN setup_fee_halalas int NOT NULL DEFAULT 0 CHECK (setup_fee_halalas >= 0),
  -- At or above this term the setup fee is not charged. NULL means it is always charged.
  ADD COLUMN setup_waived_from_months int CHECK (setup_waived_from_months IS NULL OR setup_waived_from_months > 0),
  -- Unused credit carries this many days past the end of the term.
  ADD COLUMN credit_rollover_days int NOT NULL DEFAULT 90 CHECK (credit_rollover_days >= 0),
  -- Seats: the component that grows revenue without growing consumption.
  ADD COLUMN included_seats int NOT NULL DEFAULT 5 CHECK (included_seats > 0),
  ADD COLUMN extra_seat_halalas int NOT NULL DEFAULT 0 CHECK (extra_seat_halalas >= 0),
  -- Active portfolios.
  ADD COLUMN included_portfolios int NOT NULL DEFAULT 3 CHECK (included_portfolios > 0),
  ADD COLUMN extra_portfolio_halalas int NOT NULL DEFAULT 0 CHECK (extra_portfolio_halalas >= 0),
  -- Re-verifying the same entity within this many days is free, which is a promise made
  -- in the offer and therefore a rule in the plan rather than a discount somebody applies.
  ADD COLUMN free_reverify_days int NOT NULL DEFAULT 30 CHECK (free_reverify_days >= 0);

-- The commitment a subscriber signed, not a subscription they renew.
ALTER TABLE tenant_subscriptions RENAME TO tenant_commitments;
ALTER TABLE tenant_commitments RENAME CONSTRAINT ck_period TO ck_term;

ALTER TABLE tenant_commitments
  RENAME COLUMN current_period_start TO term_start;
ALTER TABLE tenant_commitments
  RENAME COLUMN current_period_end TO term_end;

ALTER TABLE tenant_commitments
  ADD COLUMN term_months int NOT NULL DEFAULT 12 CHECK (term_months IN (3, 12, 24)),
  -- What the term granted, recorded on the row: a plan edited next year must not change
  -- what a customer was given this year.
  ADD COLUMN credits_granted_halalas int NOT NULL DEFAULT 0 CHECK (credits_granted_halalas >= 0),
  ADD COLUMN setup_fee_halalas int NOT NULL DEFAULT 0 CHECK (setup_fee_halalas >= 0),
  -- A paid trial is deducted from the contract, so it is a state of the commitment rather
  -- than a separate thing with its own rules.
  ADD COLUMN trial_credits_halalas int NOT NULL DEFAULT 0 CHECK (trial_credits_halalas >= 0),
  ADD COLUMN contract_ref text;

-- The term defaults to a year from now rather than to a calendar month.
ALTER TABLE tenant_commitments
  ALTER COLUMN term_end SET DEFAULT (date_trunc('day', now()) + interval '12 months');

COMMENT ON TABLE tenant_commitments IS
  'An annual commitment drawn down by usage. Not a subscription: see blueprint section 9.';

-- Quotas are monthly allowances inside a term that is not monthly, so usage is counted by
-- calendar month and the term is counted separately. Both numbers are needed: the quota
-- answers "may this run happen", and the term answers "what does the invoice say".
COMMENT ON TABLE product_usage IS 'Runs per calendar month, for package quotas.';
