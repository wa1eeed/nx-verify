-- Undo 0066. The comment goes back to claiming a model change stamps the column, which it does
-- not and never did.

SET LOCAL ROLE nx_migrator;

COMMENT ON COLUMN customer_standing.stale_at IS
  'Set when the customer changed or the model did. The worker recomputes what is stamped; a stale row still filters by its last known standing.';
