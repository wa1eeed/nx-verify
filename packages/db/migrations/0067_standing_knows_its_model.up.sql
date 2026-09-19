-- 0067: a standing row records which risk model computed it, and staleness is read from that.
--
-- 0066 corrected the stored comment on `customer_standing.stale_at` and left the hole the
-- comment described. A customer changing stamps the row. The risk model changing stamps
-- nothing, so a score sat under a superseded model until the worker's age sweep happened past
-- it, up to an hour later, and no reader could tell which rows those were.
--
-- The obvious repair is the wrong one. Giving the panel's role a policy on this table would let
-- staff stamp every subscriber's rows the moment a weight moves, and it would open a write
-- across subscribers on the one table that holds their customers and what we think of each of
-- them. Guard 02 lists the tables nx_operator may reach and the reason each is there: a row
-- says what a subscriber bought, or what their model is, never whom they verified. This table
-- is the second kind, and rule 2 does not bend for convenience.
--
-- So nothing is stamped. The row records the model it was computed under, and staleness is
-- derived when the row is read: a row whose recorded model is not the one in force now was
-- computed under a superseded one. The answer is immediate, it is given inside the
-- subscriber's own query, and no connection writes across anybody to produce it.
--
-- ── why a fingerprint and not a counter ──────────────────────────────────────────────────
--
-- A counter has to live somewhere one writer raises, and this model has two writers: the
-- platform's thirteen signals, and one subscriber's disagreement with them (ADR-138), both
-- edited from the same panel screen. A counter only the platform raises answers for half the
-- edits and says nothing about the other half, which is a screen telling half the truth. A
-- counter that one subscriber's edit raises for everybody marks every other workspace's rows
-- old when nothing about their model moved, and a screen that says that is a screen that lies.
--
-- The fingerprint below is raised by nobody. It is read, from the rows the model is made of.
-- It is per subscriber without a tenant argument, because the overrides it reads sit behind the
-- same policy as everything else and a subscriber's connection sees only their own. And when an
-- override is lifted it returns to the value it had before, which is right: the model returned
-- to what it was, so a row computed then is current again. A counter could not say that.
--
-- The bands are deliberately not in it. `risk_score` is a raw number and «عالية» is decided
-- when it is read, against bands the list resolves live (ADR-138), so moving a band moves the
-- facet at once and no stored row was computed under the old one. Putting them in would recompute
-- fifty thousand rows to arrive at the same fifty thousand numbers.
--
-- What is in it beside the signals is the name match threshold, because the assessment compares
-- a bank name against it and a score moves when it moves.
--
-- The age sweep stays, and this is not a replacement for it. The facts under a row age for
-- their own reasons, and a model that has not moved says nothing about a customer who has.

SET LOCAL ROLE nx_migrator;

-- ── the model as this subscriber has it, in one value ────────────────────────────────────
--
-- SECURITY INVOKER, which is the default and the point: `tenant_risk_signals` is behind
-- t_isolation, so the overrides this reads are the caller's own and the function needs no
-- tenant argument and can leak no other subscriber's model into the answer.
--
-- `trim_scale` so a threshold rewritten as 3.00 where it was 3 is the same model rather than a
-- workspace of rows recomputed to the numbers they already held.

CREATE FUNCTION app.risk_model_version() RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT md5(
    coalesce((
      SELECT string_agg(
               s.code || ' ' ||
               (coalesce(t.enabled, s.enabled))::text || ' ' ||
               (coalesce(t.weight, s.weight))::text || ' ' ||
               coalesce(trim_scale(coalesce(t.threshold, s.threshold))::text, '-'),
               E'\n' ORDER BY s.code)
        FROM risk_signals s
        LEFT JOIN tenant_risk_signals t ON t.signal_code = s.code
    ), '')
    || E'\n' ||
    coalesce((SELECT p.name_match_threshold_pct::text FROM platform_settings p), '')
  );
$$;

COMMENT ON FUNCTION app.risk_model_version() IS
  'The risk model in force for the tenant in scope, as one value: every signal with this subscriber''s overrides applied, and the name match threshold. Read on the subscriber''s own connection, so the overrides it sees are theirs alone. Not the bands: those are applied when a score is read, so moving one recomputes nothing.';

-- Read by the subscriber's own connection when a standing row is written and when one is read.
-- The retention role deletes standing rows and never asks what model made them.
--
-- The REVOKE is the load bearing line, not the GRANT. Postgres hands EXECUTE to PUBLIC on every
-- new function, and the sentence above about a caller seeing only their own overrides is a
-- sentence about `t_isolation`, which is not the only policy on `tenant_risk_signals`:
-- `operator_manage` reads USING (true). So the panel's role, left with the default grant, would
-- get an answer folded out of every subscriber's overrides at once, and with two of them
-- disagreeing about the same signal the unfiltered join would count that signal twice and the
-- value would mean nothing at all. Nobody calls it from there today; this is so that nobody can.
REVOKE ALL ON FUNCTION app.risk_model_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.risk_model_version() TO nx_app;

-- ── what the row remembers ───────────────────────────────────────────────────────────────
--
-- Null on every row that exists today, which reads as «computed under a model nobody recorded»
-- and therefore as old. That is the honest state: those rows really were computed under a model
-- this column cannot name. The sweep refreshes them at the rate it always did, and within one
-- pass every row carries the model that made it.

ALTER TABLE customer_standing ADD COLUMN risk_model_version text;

COMMENT ON COLUMN customer_standing.risk_model_version IS
  'The risk model this row was computed under, as app.risk_model_version() answered then. A value other than the one in force now means the row was computed under a superseded model; NULL means the model that computed it was never recorded, which reads the same way. Derived on read, never stamped: no connection writes across subscribers to say a model moved.';

COMMENT ON COLUMN customer_standing.stale_at IS
  'Set when the customer changed: normalisation stamps it when a new answer lands, and so does reading a change on them. A model change is not stamped and never was; it is read from risk_model_version instead (0067). A stale row still filters by its last known standing.';

RESET ROLE;
