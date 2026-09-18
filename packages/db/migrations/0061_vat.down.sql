-- Undo 0061.

SET LOCAL ROLE nx_migrator;

DROP FUNCTION IF EXISTS app.vat_on(date);
ALTER TABLE cost_book DROP COLUMN IF EXISTS vat_bps;
DROP TABLE IF EXISTS vat_periods;
