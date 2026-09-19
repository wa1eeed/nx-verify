-- 0066: the stored comment on customer_standing.stale_at said something that does not happen.
--
-- Migration 0053 introduced the column with a comment reading «Set when the customer changed or
-- the model did», and the prose above it said the stamping happens «in bulk when that happens».
-- Half of that is true. A customer changing stamps the row: `markStandingStale` is called from
-- normalisation, so a new answer invalidates the standing it was computed from.
--
-- The model changing does not. No risk-admin write touches this table, and it cannot as the
-- schema stands: `customer_standing` grants only `nx_app` and `nx_retention`, and its single
-- policy is `t_isolation USING (tenant_id = app.current_tenant())`, which is NULL on the
-- operator connection a panel edit runs on. Giving the operator role a policy on a table
-- holding customers and their scores is a real decision about rule 2, not a detail to slip in
-- behind a comment.
--
-- What carries a model change today is the worker's age sweep: a standing older than
-- `maxAgeMinutes` is recomputed whatever stamped it. That is slower and it is honest, and the
-- list recomputes live besides, so nothing a subscriber reads is wrong in the meantime.
--
-- A comment stored in the database is read by whoever inspects the schema years from now, with
-- no way to check it against the code. Correcting it is the whole of this migration.
--
-- 0053's own file is left exactly as it was, and its prose still carries the claim. An applied
-- migration is immutable here: the migrator records a checksum and refuses a file that changed
-- after it ran, so correcting the text in place would break every deployment that already has
-- it. The stored comment is the copy that matters, and this migration is how it gets fixed.

SET LOCAL ROLE nx_migrator;

COMMENT ON COLUMN customer_standing.stale_at IS
  'Set when the customer changed: normalisation stamps it when a new answer lands. A model change does NOT stamp it, because the panel edits on a connection this table has no policy for; the worker''s age sweep carries that instead. A stale row still filters by its last known standing.';
