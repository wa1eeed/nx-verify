-- 0047: the administration panel of handoff screen 05, and who changes what in it.
--
--   operator_accounts        named staff with a role, in place of one shared token (PLAN.md,
--                            decision 5). The token stays for one thing: making the first
--                            owner. «آخر تعديل بواسطة» and the audit trail name a person.
--   platform_settings        how verification behaves for every subscriber: attempts when
--                            the authority cannot be reached, how long a result counts as
--                            current, the name match a bank account needs, how early a
--                            registry about to lapse is flagged. One row.
--   section_requirements     which sections a file of each kind needs, and in what order.
--   credit_bundles           operations bought once and spent over months, the second way to
--                            pay after a package (decision 3).
--   bundle_grants            a bundle a subscriber bought: how many operations, how many are
--                            spent, when it lapses.
--   tenant_price_discounts   a discount on every product for one subscriber. A price for one
--                            product was already an override row.
--
-- And four changes around them: a product can be suspended from sale, a run can be paid from
-- a bundle, a top up can buy a bundle, and the default price list is edited from the panel
-- rather than by a migration. The result validity becomes the TTL of every fact no policy
-- names, computed on read like every TTL (ADR-007), so changing it touches no attestation.

SET LOCAL ROLE nx_migrator;

-- ── staff ────────────────────────────────────────────────────────────────────────────────

CREATE TABLE operator_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name    text NOT NULL CHECK (length(display_name) BETWEEN 2 AND 80),
  -- OWNER: everything, and staff. PRICING: prices, bundles, plans, settings. SUPPORT:
  -- subscribers and their balances. READ_ONLY: sees, changes nothing.
  role            text NOT NULL CHECK (role IN ('OWNER', 'PRICING', 'SUPPORT', 'READ_ONLY')),
  password_hash   bytea NOT NULL,
  password_salt   bytea NOT NULL,
  password_params jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  failed_attempts int NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until    timestamptz,
  last_sign_in_at timestamptz,
  created_by      uuid REFERENCES operator_accounts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_operator_account_email ON operator_accounts (lower(email));

-- Staff carry no tenant, and no subscriber connection may read them.
REVOKE ALL ON operator_accounts FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON operator_accounts TO nx_operator;

-- ── how verification behaves ─────────────────────────────────────────────────────────────

CREATE TABLE platform_settings (
  id                       boolean PRIMARY KEY DEFAULT true CHECK (id),
  max_attempts             int NOT NULL DEFAULT 2 CHECK (max_attempts BETWEEN 1 AND 5),
  result_validity_days     int NOT NULL DEFAULT 90 CHECK (result_validity_days BETWEEN 1 AND 3650),
  name_match_threshold_pct int NOT NULL DEFAULT 85 CHECK (name_match_threshold_pct BETWEEN 50 AND 100),
  registry_alert_days      int NOT NULL DEFAULT 30 CHECK (registry_alert_days BETWEEN 1 AND 365),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               text
);

INSERT INTO platform_settings (id) VALUES (true);

-- Every subscriber's screens and runs read these, and none may change them.
GRANT SELECT ON platform_settings TO nx_app, nx_retention;
GRANT SELECT, UPDATE ON platform_settings TO nx_operator;

CREATE TABLE section_requirements (
  kind        text NOT NULL CHECK (kind IN ('COMPANY', 'ESTABLISHMENT', 'FREELANCER')),
  section     text NOT NULL CHECK (
    section IN ('REGISTRY', 'CONTRACT', 'MANAGERS', 'ADDRESS', 'BANKING', 'FREELANCE', 'PROPERTY')
  ),
  requirement text NOT NULL CHECK (requirement IN ('REQUIRED', 'OPTIONAL', 'NOT_APPLICABLE')),
  position    int NOT NULL CHECK (position > 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (kind, section)
);

-- The layouts of screen 03, as the handoff draws them (PLAN.md, decision 8 for the address).
INSERT INTO section_requirements (kind, section, requirement, position) VALUES
  ('COMPANY', 'REGISTRY', 'REQUIRED', 1),
  ('COMPANY', 'CONTRACT', 'REQUIRED', 2),
  ('COMPANY', 'MANAGERS', 'REQUIRED', 3),
  ('COMPANY', 'ADDRESS', 'REQUIRED', 4),
  ('COMPANY', 'BANKING', 'REQUIRED', 5),
  ('ESTABLISHMENT', 'REGISTRY', 'REQUIRED', 1),
  ('ESTABLISHMENT', 'MANAGERS', 'OPTIONAL', 2),
  ('ESTABLISHMENT', 'ADDRESS', 'REQUIRED', 3),
  ('ESTABLISHMENT', 'BANKING', 'REQUIRED', 4),
  ('FREELANCER', 'REGISTRY', 'REQUIRED', 1),
  ('FREELANCER', 'FREELANCE', 'REQUIRED', 2),
  ('FREELANCER', 'ADDRESS', 'NOT_APPLICABLE', 3),
  ('FREELANCER', 'BANKING', 'REQUIRED', 4);

GRANT SELECT ON section_requirements TO nx_app;
GRANT SELECT, INSERT, UPDATE ON section_requirements TO nx_operator;

-- ── bundles ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE credit_bundles (
  code            text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  operations      int NOT NULL CHECK (operations > 0),
  -- Before VAT, like every stored price.
  price_halalas   bigint NOT NULL CHECK (price_halalas > 0),
  validity_months int NOT NULL DEFAULT 12 CHECK (validity_months BETWEEN 1 AND 36),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  sort_order      int NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text
);

-- Priced so that an operation covers the dearest call it can be spent on with room to
-- spare: guard 10 holds for a run a bundle pays for as it does for one the wallet pays.
INSERT INTO credit_bundles (code, operations, price_halalas, validity_months, sort_order) VALUES
  ('BUNDLE_500', 500, 1000000, 12, 10),
  ('BUNDLE_2000', 2000, 3680000, 12, 20),
  ('BUNDLE_10000', 10000, 17000000, 12, 30);

GRANT SELECT ON credit_bundles TO nx_app;
GRANT SELECT, INSERT, UPDATE ON credit_bundles TO nx_operator;

CREATE TABLE bundle_grants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  bundle_code      text NOT NULL REFERENCES credit_bundles(code),
  operations       int NOT NULL CHECK (operations > 0),
  used             int NOT NULL DEFAULT 0,
  price_halalas    bigint NOT NULL CHECK (price_halalas > 0),
  granted_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  topup_request_id uuid REFERENCES topup_requests(id),
  granted_by       text NOT NULL,
  CONSTRAINT ck_bundle_used CHECK (used BETWEEN 0 AND operations),
  CONSTRAINT ck_bundle_expiry CHECK (expires_at > granted_at)
);

CREATE INDEX ix_bundle_grants_open ON bundle_grants (tenant_id, expires_at) WHERE used < operations;
-- One grant for one confirmed top up: confirming twice grants once.
CREATE UNIQUE INDEX uq_bundle_grant_topup ON bundle_grants (topup_request_id)
  WHERE topup_request_id IS NOT NULL;

ALTER TABLE bundle_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE bundle_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON bundle_grants
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
-- Staff read what each subscriber holds, for the balances of screen 06.
CREATE POLICY operator_read ON bundle_grants FOR SELECT TO nx_operator USING (true);

-- Granted when a transfer that bought a bundle is confirmed, which moves a subscriber's own
-- balance and so runs with that subscriber in scope, like crediting a wallet does.
GRANT SELECT, INSERT, UPDATE ON bundle_grants TO nx_app;
GRANT SELECT ON bundle_grants TO nx_operator;
GRANT SELECT ON bundle_grants TO nx_retention;

-- A top up that buys a bundle rather than wallet credit.
ALTER TABLE topup_requests ADD COLUMN bundle_code text REFERENCES credit_bundles(code);

-- A run a bundle paid for.
ALTER TABLE verification_runs DROP CONSTRAINT verification_runs_charge_source_check;
ALTER TABLE verification_runs ADD CONSTRAINT verification_runs_charge_source_check
  CHECK (charge_source IN ('PACKAGE', 'BUNDLE', 'WALLET', 'FREE'));

-- ── special prices ───────────────────────────────────────────────────────────────────────

CREATE TABLE tenant_price_discounts (
  tenant_id    uuid PRIMARY KEY REFERENCES tenants(id),
  discount_pct numeric(5, 2) NOT NULL CHECK (discount_pct > 0 AND discount_pct < 100),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL
);

ALTER TABLE tenant_price_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_price_discounts FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON tenant_price_discounts
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY operator_manage ON tenant_price_discounts TO nx_operator USING (true) WITH CHECK (true);

GRANT SELECT ON tenant_price_discounts TO nx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_price_discounts TO nx_operator;

-- ── the catalogue and its price list, from the panel ─────────────────────────────────────

-- Suspended: off sale for now, and back on with one click. Retired stays for good.
ALTER TABLE products DROP CONSTRAINT products_status_check;
ALTER TABLE products ADD CONSTRAINT products_status_check
  CHECK (status IN ('active', 'suspended', 'retired'));

-- The default price list, versioned as ever: the trigger lets a row be closed and nothing
-- else, so a new price is a new row and the old one keeps saying what was charged.
CREATE POLICY operator_default_prices_panel ON price_book
  TO nx_operator
  USING (tenant_id IS NULL)
  WITH CHECK (tenant_id IS NULL);
GRANT SELECT, INSERT, UPDATE ON price_book TO nx_operator;

-- What a call costs, so the panel can show a margin and refuse a price under it.
GRANT SELECT ON cost_book TO nx_operator;

-- ── result validity ──────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS entity_profile;

CREATE VIEW entity_profile WITH (security_invoker = true) AS
SELECT DISTINCT ON (a.tenant_id, a.entity_id, a.field_path)
  a.tenant_id,
  a.entity_id,
  a.field_path,
  a.value,
  a.authority,
  a.observed_at,
  a.confidence,
  a.id AS attestation_id,
  policy.ttl_days,
  policy.weight,
  COALESCE(a.valid_until, a.observed_at + make_interval(days => policy.ttl_days)) AS effective_until,
  app.freshness_state(
    COALESCE(a.valid_until, a.observed_at + make_interval(days => policy.ttl_days)),
    policy.ttl_days
  ) AS freshness
FROM attestations a
LEFT JOIN LATERAL (
  SELECT matched.ttl_days, matched.weight
  FROM (
    SELECT p.ttl_days, p.weight, 0 AS fallback,
           (p.portfolio_id IS NOT NULL) AS from_portfolio, p.tenant_id, length(p.field_path) AS depth
    FROM freshness_policy p
    WHERE (a.field_path = p.field_path OR a.field_path LIKE p.field_path || '.%')
      AND (
        -- A portfolio row applies only to entities that belong to that portfolio.
        (p.portfolio_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM portfolio_members m
           WHERE m.tenant_id = a.tenant_id
             AND m.entity_id = a.entity_id
             AND m.portfolio_id = p.portfolio_id
         ))
        OR (p.portfolio_id IS NULL AND (p.tenant_id = a.tenant_id OR p.tenant_id IS NULL))
      )
    UNION ALL
    -- No policy names the field: the platform's result validity applies (screen 05).
    SELECT s.result_validity_days, NULL::int, 1, false, NULL::uuid, 0
    FROM platform_settings s
  ) matched
  -- Specificity as before: a portfolio beats a tenant setting, a tenant setting beats the
  -- system default, a longer field path beats a shorter one, among portfolios the shortest
  -- retention wins, and the platform's validity comes last of all.
  ORDER BY
    matched.fallback ASC,
    matched.from_portfolio DESC,
    matched.tenant_id NULLS LAST,
    matched.depth DESC,
    matched.ttl_days ASC
  LIMIT 1
) policy ON true
WHERE a.superseded_by IS NULL
ORDER BY a.tenant_id, a.entity_id, a.field_path, a.observed_at DESC;

COMMENT ON VIEW entity_profile IS
  'Latest live attestation per field, aged against the TTL in force now. Rule 5: source is absent by design.';

GRANT SELECT ON entity_profile TO nx_app;
