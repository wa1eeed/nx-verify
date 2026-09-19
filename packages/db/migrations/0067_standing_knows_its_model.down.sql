-- Undo 0067. The row stops recording which model computed it, and a model change goes back to
-- being carried by the worker's age sweep alone.

SET LOCAL ROLE nx_migrator;

ALTER TABLE customer_standing DROP COLUMN risk_model_version;

DROP FUNCTION app.risk_model_version();

COMMENT ON COLUMN customer_standing.stale_at IS
  'Set when the customer changed: normalisation stamps it when a new answer lands. A model change does NOT stamp it, because the panel edits on a connection this table has no policy for; the worker''s age sweep carries that instead. A stale row still filters by its last known standing.';

RESET ROLE;
