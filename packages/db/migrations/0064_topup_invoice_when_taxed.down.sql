-- Undo 0064. The invoice becomes unconditional again, so any row confirmed without one has
-- to go first or the restored CHECK refuses the whole table.

SET LOCAL ROLE nx_migrator;

DROP TRIGGER IF EXISTS trg_topup_requires_invoice ON topup_requests;
DROP FUNCTION IF EXISTS app.topup_requires_invoice();

UPDATE topup_requests
   SET vat_invoice_id = 'UNTAXED-' || reference
 WHERE status = 'CONFIRMED' AND vat_invoice_id IS NULL;

ALTER TABLE topup_requests DROP CONSTRAINT ck_topup_settled;
ALTER TABLE topup_requests ADD CONSTRAINT ck_topup_settled CHECK (
  status <> 'CONFIRMED' OR (vat_invoice_id IS NOT NULL AND settled_at IS NOT NULL)
);
