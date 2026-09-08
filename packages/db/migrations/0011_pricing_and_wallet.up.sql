-- 0011: cost, price, balance and ledger.
--
-- Three rules from docs/03-products.md section 6 are enforced here rather than left to
-- application code.
--
-- Prices are versioned, never edited. Changing a price closes the current row and opens
-- a new one, so every run can be priced by the row that was in force at its created_at.
-- A trigger allows exactly one mutation, closing an open row.
--
-- The ledger is append only, like attestations and for the same reason. A balance that
-- can be edited is a balance nobody can defend in a billing dispute.
--
-- A step that did not run is not billed, and an error is never billed. run_steps already
-- carries those checks; the ledger side is enforced by the settlement code and proven by
-- guard 04.

SET LOCAL ROLE nx_migrator;

-- What a provider charges us. Internal, and never part of any public projection: it
-- would expose our margin. It carries no tenant_id because a provider's price list is
-- not tenant data.
CREATE TABLE cost_book (
  provider   text NOT NULL,
  endpoint   text NOT NULL,
  unit_cost  numeric(10,2) NOT NULL CHECK (unit_cost >= 0),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to   timestamptz,
  PRIMARY KEY (provider, endpoint, valid_from)
);

GRANT SELECT, INSERT, UPDATE ON cost_book TO nx_app;

CREATE TABLE price_book (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL means the default list price. A row with a tenant is that tenant's price.
  tenant_id    uuid,
  product_code text NOT NULL REFERENCES products(code),
  unit_price   numeric(10,2) NOT NULL,
  tier_min     int NOT NULL DEFAULT 0,
  tier_max     int,
  -- A query that answered "this subject does not exist" is a real result and is billed
  -- at this fraction. A technical error is never billed at all.
  negative_pct numeric(4,2) NOT NULL DEFAULT 0.50,
  -- Declared, never implied. docs/03-products.md is explicit that the only wrong choice
  -- about cache billing is an ambiguous one.
  cache_pct    numeric(4,2) NOT NULL DEFAULT 1.00,
  valid_from   timestamptz NOT NULL DEFAULT now(),
  valid_to     timestamptz,
  version      int NOT NULL DEFAULT 1,
  contract_id  uuid,
  CONSTRAINT ck_margin CHECK (unit_price > 0),
  CONSTRAINT ck_negative_pct CHECK (negative_pct >= 0 AND negative_pct <= 1),
  CONSTRAINT ck_cache_pct CHECK (cache_pct >= 0 AND cache_pct <= 1),
  CONSTRAINT ck_tier CHECK (tier_max IS NULL OR tier_max > tier_min)
);

CREATE INDEX ix_price_lookup ON price_book (product_code, tenant_id, valid_from DESC);

-- One open price per (tenant, product, tier, contract). Two open rows would make the
-- price of a run ambiguous, which is the one thing a price list may never be.
CREATE UNIQUE INDEX uq_price_open
  ON price_book (
    product_code,
    (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (COALESCE(contract_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    tier_min
  )
  WHERE valid_to IS NULL;

CREATE FUNCTION app.price_book_forbid_edit() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.valid_to IS NOT NULL THEN
    RAISE EXCEPTION 'a closed price row is immutable' USING ERRCODE = 'NX003';
  END IF;
  IF NEW.valid_to IS NULL THEN
    RAISE EXCEPTION 'the only permitted price update is closing the row'
      USING ERRCODE = 'NX003';
  END IF;
  IF (to_jsonb(NEW) - 'valid_to') IS DISTINCT FROM (to_jsonb(OLD) - 'valid_to') THEN
    RAISE EXCEPTION 'prices are versioned: close this row and insert a new one'
      USING ERRCODE = 'NX003';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_price_book_forbid_edit
  BEFORE UPDATE ON price_book
  FOR EACH ROW EXECUTE FUNCTION app.price_book_forbid_edit();

ALTER TABLE price_book ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_book FORCE ROW LEVEL SECURITY;
-- A tenant sees the default list and its own prices, and writes only its own.
CREATE POLICY t_isolation ON price_book
  USING (tenant_id IS NULL OR tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- The default list price belongs to no tenant, so no tenant may write it. The operator
-- publishes it through the owner role, and this policy is the whole of that permission:
-- rows with a NULL tenant_id and nothing else. Without it the default list would have to
-- be a migration every time a price moved.
CREATE POLICY operator_default_prices ON price_book
  TO nx_migrator
  USING (tenant_id IS NULL)
  WITH CHECK (tenant_id IS NULL);

GRANT SELECT, INSERT, UPDATE ON price_book TO nx_app;
GRANT SELECT ON price_book TO nx_retention;

CREATE TABLE wallets (
  tenant_id     uuid PRIMARY KEY REFERENCES tenants(id),
  balance       numeric(12,2) NOT NULL DEFAULT 0,
  -- Funds committed to runs that are in flight but not yet settled.
  held          numeric(12,2) NOT NULL DEFAULT 0,
  currency      char(3) NOT NULL DEFAULT 'SAR',
  expires_at    timestamptz,
  low_threshold numeric(12,2) NOT NULL DEFAULT 0.15,
  CONSTRAINT ck_wallet_held CHECK (held >= 0)
);

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON wallets
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON wallets TO nx_app;
GRANT SELECT ON wallets TO nx_retention;

CREATE TABLE wallet_ledger (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  delta          numeric(12,2) NOT NULL,
  balance_after  numeric(12,2) NOT NULL,
  reason         text NOT NULL CHECK (
    -- HOLD and RELEASE are additions to the list in the schema document. Reserving the
    -- worst case before a run and settling afterwards is required by
    -- docs/03-products.md section 6 rule 3, and it cannot be expressed with CHARGE
    -- alone without either holding a row lock across provider calls or letting a
    -- balance go negative. See ADR-019.
    reason IN ('TOPUP', 'CHARGE', 'REFUND', 'EXPIRY', 'ADJUSTMENT', 'HOLD', 'RELEASE')
  ),
  run_id         uuid,
  -- VAT is due when the balance is topped up, not when it is consumed. A TOPUP row
  -- carries the invoice; CHARGE rows never do.
  vat_invoice_id text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_ledger_run FOREIGN KEY (tenant_id, run_id) REFERENCES verification_runs (tenant_id, id),
  CONSTRAINT ck_vat_only_on_topup CHECK (vat_invoice_id IS NULL OR reason = 'TOPUP')
);

CREATE INDEX ix_ledger_tenant ON wallet_ledger (tenant_id, id DESC);
CREATE INDEX ix_ledger_run ON wallet_ledger (tenant_id, run_id) WHERE run_id IS NOT NULL;

CREATE FUNCTION app.wallet_ledger_append_only() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'the wallet ledger is append only' USING ERRCODE = 'NX004';
END;
$$;

CREATE TRIGGER trg_wallet_ledger_no_update
  BEFORE UPDATE OR DELETE ON wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION app.wallet_ledger_append_only();

ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON wallet_ledger
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT ON wallet_ledger TO nx_app;
GRANT SELECT ON wallet_ledger TO nx_retention;
