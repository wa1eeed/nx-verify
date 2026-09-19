-- 0064: a confirmed transfer needs its tax invoice only when tax was due on it.
--
-- The original CHECK said: a CONFIRMED top up must carry a vat_invoice_id, because a
-- confirmed top up without its tax invoice is an accounting problem waiting to be found at
-- the year end. That reasoning is right, and it was written when the platform was assumed to
-- be registered for VAT.
--
-- It is not. So staff confirming a transfer had to type a tax invoice number for a
-- transaction that carries no tax and for which no such invoice exists, and what people do
-- when a form demands a number that does not exist is invent one. The column then records a
-- fiction and the constraint that demanded it protects nothing at all.
--
-- A CHECK cannot read another table, so the requirement becomes a trigger, exactly as the
-- four eyes rule did in migration 0018. It asks `app.vat_on` for the rule in force on the day
-- the transfer was settled: an invoice is required for a period we were registered in, and
-- nothing is required for a period we were not. The accounting reason is preserved and the
-- fiction is not.

SET LOCAL ROLE nx_migrator;

ALTER TABLE topup_requests DROP CONSTRAINT ck_topup_settled;
ALTER TABLE topup_requests ADD CONSTRAINT ck_topup_settled CHECK (
  status <> 'CONFIRMED' OR settled_at IS NOT NULL
);

CREATE FUNCTION app.topup_requires_invoice() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  taxed boolean;
BEGIN
  IF NEW.status <> 'CONFIRMED' THEN
    RETURN NEW;
  END IF;

  -- The rule of the day of supply, not of today: a transfer confirmed before registration
  -- stays correct however long afterwards the row is touched.
  SELECT registered INTO taxed
    FROM app.vat_on(COALESCE(NEW.settled_at, now())::date);

  IF taxed AND NEW.vat_invoice_id IS NULL THEN
    RAISE EXCEPTION 'a confirmed top up in a taxed period needs its tax invoice'
      USING ERRCODE = 'NX006';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_topup_requires_invoice
  BEFORE INSERT OR UPDATE ON topup_requests
  FOR EACH ROW EXECUTE FUNCTION app.topup_requires_invoice();
