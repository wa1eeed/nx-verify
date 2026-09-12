SET LOCAL ROLE nx_migrator;

COMMENT ON TABLE product_usage IS NULL;
COMMENT ON TABLE tenant_commitments IS NULL;

ALTER TABLE tenant_commitments
  ALTER COLUMN term_end SET DEFAULT (date_trunc('month', now()) + interval '1 month');

ALTER TABLE tenant_commitments
  DROP COLUMN contract_ref,
  DROP COLUMN trial_credits_halalas,
  DROP COLUMN setup_fee_halalas,
  DROP COLUMN credits_granted_halalas,
  DROP COLUMN term_months;

ALTER TABLE tenant_commitments RENAME COLUMN term_end TO current_period_end;
ALTER TABLE tenant_commitments RENAME COLUMN term_start TO current_period_start;
ALTER TABLE tenant_commitments RENAME CONSTRAINT ck_term TO ck_period;
ALTER TABLE tenant_commitments RENAME TO tenant_subscriptions;

ALTER TABLE packages
  DROP COLUMN free_reverify_days,
  DROP COLUMN extra_portfolio_halalas,
  DROP COLUMN included_portfolios,
  DROP COLUMN extra_seat_halalas,
  DROP COLUMN included_seats,
  DROP COLUMN credit_rollover_days,
  DROP COLUMN setup_waived_from_months,
  DROP COLUMN setup_fee_halalas,
  DROP COLUMN commitment_credits_halalas,
  DROP COLUMN term_months,
  ADD COLUMN monthly_fee_halalas int NOT NULL DEFAULT 0 CHECK (monthly_fee_halalas >= 0),
  ADD COLUMN included_credits_halalas int NOT NULL DEFAULT 0
    CHECK (included_credits_halalas >= 0);
