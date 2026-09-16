-- 0050: which provider serves which verification service, set from the panel.
--
-- Routing has existed since 0020, at the level of (subscriber × provider × endpoint). What it
-- could not express is the thing an owner actually decides: «the national address check is
-- served by this provider from today», for every subscriber at once, because that provider's
-- price moved or its contract ended.
--
-- Until now the only answer to that was the provider written into each product step, which is a
-- catalogue edit, and the margin on the pricing screen was computed against that declared
-- provider rather than against whoever would really take the call. So switching a provider
-- silently made every margin on that screen wrong.
--
-- This adds one table. A row says: for this verification service, prefer this provider, at this
-- rank. The resolver consults a subscriber's own binding first, because that is a contract with
-- one customer, then this, then the provider the step declares, which stays as the last resort
-- so a catalogue that names one keeps working.
--
-- Rule 5 is untouched. The table carries no tenant_id, no tenant may read it, and it is managed
-- by the operator role alone.

SET LOCAL ROLE nx_migrator;

CREATE TABLE product_provider_routing (
  product_code text NOT NULL REFERENCES products (code) ON DELETE CASCADE,
  provider     text NOT NULL REFERENCES provider_catalog (code) ON DELETE CASCADE,
  -- Lower runs first. A second provider carried at rank 2 is the answer to an outage and to a
  -- price rise alike: it is already bound, already tested, and already next in line.
  priority     int NOT NULL DEFAULT 100 CHECK (priority > 0),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'standby')),
  note         text CHECK (note IS NULL OR length(note) <= 200),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text,
  PRIMARY KEY (product_code, provider)
);

COMMENT ON TABLE product_provider_routing IS
  'Which provider serves a verification service, platform wide. A subscriber binding overrides it; the provider named in a product step is the last resort.';
COMMENT ON COLUMN product_provider_routing.status IS
  'active takes calls. standby is carried ready and skipped, so a provider can be prepared and tested before it serves anybody.';

CREATE INDEX ix_service_routing_order ON product_provider_routing (product_code, priority)
  WHERE status = 'active';

REVOKE ALL ON product_provider_routing FROM PUBLIC;
-- The application reads it to place a call. It never writes it.
GRANT SELECT ON product_provider_routing TO nx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_provider_routing TO nx_operator;

/**
 * Which providers may serve this step of this product, most preferred first.
 *
 * Replaces app.resolve_providers, which knew nothing about the service being run. The order
 * below is the whole decision, and it took a failing test to get right: a subscriber's general
 * binding is not an opinion about which provider serves the national address check, it is the
 * answer to «with whose credential, and on what terms». Left first in the order, it silently
 * ignored every choice made in the panel, which is exactly what this table exists to express.
 *
 *   1. a binding that is BYOC, or that names endpoints. Both are deliberate statements about
 *      one subscriber: their own account, or this provider for these services and no others
 *   2. what the panel routes this service to, which is the platform's choice for everybody
 *   3. a general MANAGED binding, which says we serve them and not who with
 *   4. the provider the product step declares, added by the caller, last of all
 *
 * A provider is skipped when it is down, when it cannot serve this endpoint, or when the
 * service carries it on standby. Health is why a second provider needs no intervention during
 * an outage: it is already next.
 */
CREATE FUNCTION app.resolve_service_providers(p_tenant uuid, p_product text, p_endpoint text)
  RETURNS TABLE (provider text, mode text, credential_ref text, priority int, level text)
  LANGUAGE sql
  STABLE
  -- Reads the catalogue, which the application role deliberately cannot read: reading it is
  -- learning the provider names (rule 5). So this runs as its owner and hands back the one
  -- thing the application must know to place a call, exactly as app.resolve_api_key does for
  -- a key. Row level security still applies to the owner, because every tenant table forces it.
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  WITH bindings AS (
    SELECT b.provider, b.mode, b.credential_ref, b.priority,
           (b.mode = 'BYOC' OR b.endpoints IS NOT NULL) AS deliberate
    FROM tenant_provider_binding b
    WHERE b.tenant_id = p_tenant
      AND b.health_status <> 'down'
      AND b.activated_at IS NOT NULL
      AND (b.endpoints IS NULL OR p_endpoint = ANY (b.endpoints))
  ),
  routed AS (
    SELECT r.provider, r.priority,
           COALESCE(b.mode, 'MANAGED') AS mode,
           COALESCE(b.credential_ref, c.credential_ref) AS credential_ref
    FROM product_provider_routing r
    JOIN provider_catalog p ON p.code = r.provider AND p.status = 'active'
    LEFT JOIN bindings b ON b.provider = r.provider
    LEFT JOIN LATERAL (
      -- The credential of whichever environment is configured. The application resolves the
      -- reference; what it needs from here is which provider, and under which reference.
      SELECT credential_ref FROM provider_connections
      WHERE provider = r.provider AND status = 'active'
      ORDER BY environment DESC LIMIT 1
    ) c ON true
    WHERE r.product_code = p_product
      AND r.status = 'active'
      AND (cardinality(p.endpoints) = 0 OR p_endpoint = ANY (p.endpoints))
  )
  SELECT provider, mode, credential_ref, priority, level FROM (
    SELECT provider, mode, credential_ref, priority, 'tenant'::text AS level, 1 AS rank
    FROM bindings WHERE deliberate
    UNION ALL
    SELECT provider, mode, credential_ref, priority, 'service'::text, 2 FROM routed
    UNION ALL
    SELECT provider, mode, credential_ref, priority, 'tenant'::text, 3
    FROM bindings WHERE NOT deliberate
  ) AS chain
  ORDER BY rank, priority, provider;
$$;

REVOKE ALL ON FUNCTION app.resolve_service_providers(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_service_providers(uuid, text, text) TO nx_app;

/**
 * What one run of a service costs us, under a named provider.
 *
 * The pricing screen used to sum the cost of each step at the provider the step declares. That
 * is the wrong provider the moment routing sends the call elsewhere, and it is the number an
 * owner uses to decide a price. This asks the real question: if this provider served this
 * service, what would it cost.
 *
 * NULL for a step this provider has no price for, which is how the screen can say «this
 * provider does not serve this service» rather than showing a cost that is missing a call.
 */
CREATE FUNCTION app.service_cost(p_product text, p_provider text)
  RETURNS numeric
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN count(*) FILTER (WHERE c.unit_cost IS NULL) > 0 THEN NULL
              ELSE COALESCE(sum(c.unit_cost), 0) END
  FROM product_steps s
  LEFT JOIN LATERAL (
    SELECT unit_cost FROM cost_book
    WHERE provider = p_provider AND endpoint = s.endpoint
      AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())
    ORDER BY valid_from DESC LIMIT 1
  ) c ON true
  WHERE s.product_code = p_product;
$$;

REVOKE ALL ON FUNCTION app.service_cost(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.service_cost(text, text) TO nx_app, nx_operator;

/**
 * What each provider actually served, and what it cost, per month.
 *
 * The question this answers is the one an owner asks the moment they switch a provider: did the
 * calls really move. A run records the provider that served it, but reading runs across
 * subscribers is exactly what rule 2 forbids, so the count is aggregated as the work happens
 * and the panel reads the counter.
 *
 * No tenant_id, deliberately: this is a platform operational figure, like operator_audit, and
 * it carries no customer, no subject and no identifier. Only a provider, a service, how many
 * calls and what they cost.
 */
CREATE TABLE provider_usage (
  -- No foreign key to the catalogue, deliberately. A provider that served a call is a fact
  -- whether or not somebody has catalogued it, and a counter that can refuse a row is a counter
  -- that can fail the verification it was only meant to count.
  provider     text NOT NULL CHECK (provider <> ''),
  product_code text NOT NULL,
  endpoint     text NOT NULL,
  period_start date NOT NULL,
  calls        int NOT NULL DEFAULT 0 CHECK (calls >= 0),
  failed       int NOT NULL DEFAULT 0 CHECK (failed >= 0),
  cost_halalas bigint NOT NULL DEFAULT 0 CHECK (cost_halalas >= 0),
  last_call_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, product_code, endpoint, period_start)
);

COMMENT ON TABLE provider_usage IS
  'Calls served per provider per service per month, so a switch can be proved rather than claimed. No tenant, no subject, no identifier.';

CREATE INDEX ix_provider_usage_recent ON provider_usage (product_code, period_start DESC);

REVOKE ALL ON provider_usage FROM PUBLIC;
-- The application counts a call as it places it. It never reads the counter back.
GRANT INSERT, UPDATE, SELECT ON provider_usage TO nx_app;
GRANT SELECT ON provider_usage TO nx_operator;

-- ── the property section, which had a service and no place to put it ──────────────────────
--
-- PROPERTY_VERIFICATION has been in the catalogue with profile_section = 'PROPERTY' since
-- migration 0045, and the layout that decides which sections a customer file draws has never
-- had a row for it. So the service existed, could be priced and could be run, and its answers
-- had nowhere to appear. It is OPTIONAL for all three kinds: most customers own no property,
-- and a file is not incomplete for that.
INSERT INTO section_requirements (kind, section, requirement, position) VALUES
  ('COMPANY', 'PROPERTY', 'OPTIONAL', 6),
  ('ESTABLISHMENT', 'PROPERTY', 'OPTIONAL', 5),
  ('FREELANCER', 'PROPERTY', 'OPTIONAL', 5)
ON CONFLICT (kind, section) DO NOTHING;
