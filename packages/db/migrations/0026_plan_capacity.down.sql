SET LOCAL ROLE nx_migrator;

REVOKE UPDATE (transactions_used, updated_at) ON tenant_commitments FROM nx_app;

COMMENT ON COLUMN packages.credit_rollover_days IS NULL;

ALTER TABLE tenant_commitments
  DROP COLUMN platform_fee_halalas,
  DROP COLUMN transactions_used,
  DROP COLUMN included_transactions;

ALTER TABLE packages
  DROP COLUMN platform_fee_halalas,
  DROP COLUMN overage_unit_halalas,
  DROP COLUMN included_transactions,
  DROP COLUMN billing_model;
