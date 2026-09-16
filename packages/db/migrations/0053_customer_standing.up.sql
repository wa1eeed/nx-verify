-- 0053: the customers list, at the size a real subscriber reaches.
--
-- Measured first (rule 9), in docs/explanation/measurements.md: at 50,000 customers and a
-- million attestations the unfiltered list did not answer inside ten minutes, and the filtered
-- cases took twenty four seconds. One customer's file was 2 ms. The projection was never the
-- problem; the list was.
--
-- Why it was that bad. The list joined every entity to entity_profile, which resolves a time to
-- live per attestation through a LATERAL that no planner can unnest, then aggregated, then
-- sorted on an aggregate, and only then took a hundred rows. Nothing narrowed the work before
-- the aggregate, so a million rows were built to return a hundred, and the LIMIT was decorative.
-- The screen made it worse by asking for five thousand summaries whatever page it was showing,
-- filtering them in JavaScript and slicing the result in memory.
--
-- This migration adds the one thing SQL cannot compute cheaply: where each customer stands.
--
--   customer_standing   one row per customer, with what the list filters, orders and counts by
--
-- What it is NOT is a copy of the customer file. The rows the screen draws are still summarised
-- live from the model, so a row and the file it opens can never disagree (the test that proves
-- that stays). This table answers «which twenty five, in what order, and how many of each»,
-- which is the only part that cannot wait for the model to run over everybody.
--
-- Staleness is explicit rather than hoped for. The score depends on a model staff can now edit
-- (ADR-138) and on modules they can switch (ADR-137), so a weight changed at noon invalidates
-- every row. `stale_at` is stamped in bulk when that happens and the worker refreshes what is
-- stamped. A stale row still filters and counts by its last known standing, which is the right
-- failure: a facet that lags by a minute is useful, and a facet that waits for a million rows
-- is not.

SET LOCAL ROLE nx_migrator;

CREATE TABLE customer_standing (
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  entity_id     uuid NOT NULL,
  -- What the registry called them, so «الشركات» and «المؤسسات» are a column rather than a
  -- lateral join to the latest attestation of one field path.
  kind          text CHECK (kind IS NULL OR kind IN ('COMPANY', 'ESTABLISHMENT', 'FREELANCER')),
  -- The newest observation on this customer. The list's order, and the reason the order can
  -- use an index at all: an aggregate over another table cannot.
  last_verified_at timestamptz,
  completeness  int NOT NULL DEFAULT 0 CHECK (completeness BETWEEN 0 AND 100),
  open_alerts   int NOT NULL DEFAULT 0 CHECK (open_alerts >= 0),
  risk_score    int CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 100),
  -- Stamped when this row can no longer be trusted: the customer changed, or the model did.
  -- NULL means the row was computed under the model in force now.
  stale_at      timestamptz,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity_id),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES entities (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE customer_standing IS
  'Where each customer stands, for the list to filter, order and count by. Never what a screen draws: the page is summarised live so a row and its file cannot disagree.';
COMMENT ON COLUMN customer_standing.stale_at IS
  'Set when the customer changed or the model did. The worker recomputes what is stamped; a stale row still filters by its last known standing.';

-- The list's own order, and the only index it needs for the default screen: newest first,
-- with the id breaking ties so a page boundary is stable between two customers verified in the
-- same millisecond.
CREATE INDEX ix_standing_recent
  ON customer_standing (tenant_id, last_verified_at DESC NULLS LAST, entity_id DESC);

-- «الشركات», «المؤسسات», «العاملون بأنفسهم»: a facet count and a filter, both from one index.
CREATE INDEX ix_standing_kind
  ON customer_standing (tenant_id, kind, last_verified_at DESC NULLS LAST, entity_id DESC);

-- «ما يحتاج نظرة»: the customers with something open, newest first.
CREATE INDEX ix_standing_alerts
  ON customer_standing (tenant_id, last_verified_at DESC NULLS LAST, entity_id DESC)
  WHERE open_alerts > 0;

-- What the worker claims. Partial, because the rows worth refreshing are the exception.
CREATE INDEX ix_standing_stale ON customer_standing (tenant_id, stale_at) WHERE stale_at IS NOT NULL;

-- ── every customer that already exists gets a row, before anything can hide one ───────────
--
-- Somebody is a customer of this workspace when it has verified them at least once. The two
-- columns a list cannot wait for are filled here, because both are one aggregate; the three
-- the model decides are left at their defaults and stamped stale, so the worker computes them
-- under the model in force rather than this migration guessing at it.
--
-- Written before row level security is enabled on this table, because the owner is forced to
-- obey the policy too and a migration has no tenant. For the same reason the three tables it
-- reads are taken off FORCE for the length of the statement and put back immediately, which is
-- what migration 0045 does to seed the default change rules. Guard 02 fails the build if any
-- of them is left that way.

ALTER TABLE entities NO FORCE ROW LEVEL SECURITY;
ALTER TABLE attestations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE verification_runs NO FORCE ROW LEVEL SECURITY;

INSERT INTO customer_standing (tenant_id, entity_id, kind, last_verified_at, stale_at)
SELECT e.tenant_id,
       e.id,
       CASE WHEN e.entity_type = 'FREELANCER' THEN 'FREELANCER'
            ELSE (SELECT a.value #>> '{}' FROM attestations a
                   WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
                     AND a.field_path = 'cr.kind' AND a.superseded_by IS NULL
                   ORDER BY a.observed_at DESC LIMIT 1)
       END,
       (SELECT max(a.observed_at) FROM attestations a
         WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id AND a.superseded_by IS NULL),
       now()
  FROM entities e
 WHERE e.entity_type IN ('BUSINESS', 'FREELANCER')
   AND e.archived_at IS NULL
   AND EXISTS (SELECT 1 FROM verification_runs r
                WHERE r.tenant_id = e.tenant_id AND r.entity_id = e.id)
ON CONFLICT (tenant_id, entity_id) DO NOTHING;

-- A kind the registry never said is left null rather than guessed at.
UPDATE customer_standing SET kind = NULL
 WHERE kind IS NOT NULL AND kind NOT IN ('COMPANY', 'ESTABLISHMENT', 'FREELANCER');

ALTER TABLE entities FORCE ROW LEVEL SECURITY;
ALTER TABLE attestations FORCE ROW LEVEL SECURITY;
ALTER TABLE verification_runs FORCE ROW LEVEL SECURITY;

ALTER TABLE customer_standing ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_standing FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON customer_standing
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

REVOKE ALL ON customer_standing FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_standing TO nx_app;
-- The retention sweep removes a customer's rows with the customer.
GRANT SELECT, DELETE ON customer_standing TO nx_retention;

-- ── the indexes the list needed and never had ─────────────────────────────────────────────
--
-- Both are asked for once per customer by the summary, and neither had anything to answer
-- with: verification_runs is indexed by time and change_events by time, so a question about
-- one entity scanned the whole workspace.

CREATE INDEX ix_runs_entity ON verification_runs (tenant_id, entity_id, created_at DESC);

CREATE INDEX ix_change_entity ON change_events (tenant_id, entity_id)
  WHERE acknowledged_at IS NULL;

-- Which entities a workspace has verified at all, which is what makes somebody a customer
-- rather than a company met inside another company's answer. Asked as an EXISTS over every
-- entity, so it wants the narrow index rather than the one above.
CREATE INDEX ix_runs_customer ON verification_runs (tenant_id, entity_id);

-- How many customers share one national address, which is the one question about attestations
-- that names no entity to narrow by.
--
-- Narrow on purpose, to one field path. A broader index on (tenant_id, field_path, entity_id)
-- WHERE superseded_by IS NULL was measured first and made things worse: it is a usable path
-- for «every live attestation», so the planner took it for reading a single customer's file
-- and that read went from 2 ms to a second. An index that can serve a question nobody asks is
-- an invitation to answer the wrong one.
CREATE INDEX ix_att_address_key ON attestations (tenant_id, value)
  WHERE field_path = 'address.national.key' AND superseded_by IS NULL;

RESET ROLE;
