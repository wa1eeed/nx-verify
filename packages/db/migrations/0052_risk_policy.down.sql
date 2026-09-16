SET LOCAL ROLE nx_migrator;

DROP TABLE IF EXISTS tenant_risk_settings;
DROP TABLE IF EXISTS tenant_risk_signals;
DROP TABLE IF EXISTS risk_signals;

ALTER TABLE platform_settings DROP CONSTRAINT IF EXISTS ck_risk_bands_ordered;
ALTER TABLE platform_settings
  DROP COLUMN IF EXISTS risk_high_from,
  DROP COLUMN IF EXISTS risk_medium_from;
