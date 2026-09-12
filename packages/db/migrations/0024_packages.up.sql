-- 0024: what a subscriber bought.
--
-- Until now every subscriber could run every product in the catalogue, and what they paid
-- was a price list. That is a pricing model, not a commercial one: it cannot express a
-- starter plan that excludes bank verification, a growth plan with a monthly allowance, or
-- an enterprise plan negotiated one line at a time.
--
-- A package is configuration, not subscriber data, so it lives beside the provider
-- catalogue and is edited by the operator. Entitlement, which is the answer to "may this
-- subscriber run this product right now", is derived from three layers in order: an
-- override written for this one subscriber, then the package, then the catalogue. The
-- narrowest rule that mentions a product wins, and the answer is computed in the domain
-- layer so that every path reaches it: the API, the console, a batch, a monitor and the
-- MCP server.
--
-- Rule 8 still holds. A package does not define products, it selects them, and a product
-- added to the catalogue appears in the operator panel with no code change.

SET LOCAL ROLE nx_migrator;

CREATE TABLE packages (
  code                     text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  name_ar                  text NOT NULL,
  name_en                  text NOT NULL,
  description_ar           text,
  -- The subscription fee, excluding VAT like every other price here (ADR-021).
  monthly_fee_halalas      int NOT NULL DEFAULT 0 CHECK (monthly_fee_halalas >= 0),
  -- Service credits granted at the start of each cycle. Zero means pay as you go.
  included_credits_halalas int NOT NULL DEFAULT 0 CHECK (included_credits_halalas >= 0),
  -- Whether work may continue once the included credits are spent.
  overage_allowed          boolean NOT NULL DEFAULT true,
  -- NULL means no limit. A zero would mean nobody can sign in, which nobody buys.
  max_users                int CHECK (max_users IS NULL OR max_users > 0),
  max_api_keys             int CHECK (max_api_keys IS NULL OR max_api_keys > 0),
  max_monitors             int CHECK (max_monitors IS NULL OR max_monitors > 0),
  rate_limit_rpm           int NOT NULL DEFAULT 120 CHECK (rate_limit_rpm > 0),
  support_tier             text NOT NULL DEFAULT 'STANDARD'
                           CHECK (support_tier IN ('STANDARD', 'PRIORITY', 'DEDICATED')),
  status                   text NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'retired')),
  sort_order               int NOT NULL DEFAULT 100,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Which verification modules a package turns on, and on what terms.
CREATE TABLE package_products (
  package_code       text NOT NULL REFERENCES packages(code) ON DELETE CASCADE,
  product_code       text NOT NULL REFERENCES products(code) ON DELETE CASCADE,
  enabled            boolean NOT NULL DEFAULT true,
  -- Runs per cycle. NULL means no count limit, and the credits are the only limit.
  monthly_quota      int CHECK (monthly_quota IS NULL OR monthly_quota > 0),
  -- A price that belongs to the package rather than to the subscriber. NULL defers to the
  -- subscriber's price book, which is where a negotiated price lives.
  unit_price_halalas int CHECK (unit_price_halalas IS NULL OR unit_price_halalas >= 0),
  PRIMARY KEY (package_code, product_code)
);

CREATE INDEX ix_package_products_product ON package_products (product_code);

GRANT SELECT ON packages, package_products TO nx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON packages, package_products TO nx_operator;

-- Which package a subscriber is on.
--
-- Configuration about a subscriber rather than a subscriber's own data, which is why the
-- operator can see it and why it is safe for them to: it holds a package code and a
-- period, and nothing about anybody who was verified.
CREATE TABLE tenant_subscriptions (
  tenant_id            uuid PRIMARY KEY REFERENCES tenants(id),
  package_code         text NOT NULL REFERENCES packages(code),
  status               text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('trial', 'active', 'suspended', 'cancelled')),
  trial_ends_at        timestamptz,
  current_period_start timestamptz NOT NULL DEFAULT date_trunc('month', now()),
  current_period_end   timestamptz NOT NULL DEFAULT (date_trunc('month', now()) + interval '1 month'),
  started_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_period CHECK (current_period_end > current_period_start)
);

ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON tenant_subscriptions
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- The subscriber reads their own plan and never writes it: which package you are on is
-- not a decision you make in your own console.
GRANT SELECT ON tenant_subscriptions TO nx_app;
GRANT SELECT, INSERT, UPDATE ON tenant_subscriptions TO nx_operator;
CREATE POLICY operator_manage ON tenant_subscriptions
  TO nx_operator
  USING (true)
  WITH CHECK (true);

-- Because one customer always negotiates.
--
-- An override is the narrowest rule and wins over the package. It exists so that a
-- special case does not become a special package, and a special package for every
-- customer is how a catalogue of three plans becomes a catalogue of ninety.
CREATE TABLE tenant_product_overrides (
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  product_code       text NOT NULL REFERENCES products(code) ON DELETE CASCADE,
  enabled            boolean,
  monthly_quota      int CHECK (monthly_quota IS NULL OR monthly_quota > 0),
  unit_price_halalas int CHECK (unit_price_halalas IS NULL OR unit_price_halalas >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_code)
);

ALTER TABLE tenant_product_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_product_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON tenant_product_overrides
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT ON tenant_product_overrides TO nx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_product_overrides TO nx_operator;
CREATE POLICY operator_manage ON tenant_product_overrides
  TO nx_operator
  USING (true)
  WITH CHECK (true);

-- What has been used this cycle, per product.
--
-- A counter rather than a query over the runs, because rule 9 says no optimisation before
-- measurement and this is not one: a quota has to be checked before every run, and
-- counting a growing table on every request is a design that stops working at the exact
-- moment the customer becomes valuable.
CREATE TABLE product_usage (
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  period_start date NOT NULL,
  product_code text NOT NULL REFERENCES products(code) ON DELETE CASCADE,
  used         int NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, period_start, product_code)
);

ALTER TABLE product_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON product_usage
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON product_usage TO nx_app;
GRANT SELECT ON product_usage TO nx_retention;
