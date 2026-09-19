-- 0063: the panel may record what a provider call costs.
--
-- Every margin figure on every screen is arithmetic on `cost_book`, and the panel could only
-- read it. An owner who signs a new provider rate had nowhere to put it, so the platform's
-- margin was correct only for as long as the seed file happened to match the contract, and the
-- routing screen's whole premise (a provider raised their price, move this service) could not
-- be acted on.
--
-- Versioned like the price book, and for the same reason: a cost is a fact about a period. A
-- run billed in March must still be measurable against what that call cost in March, so a new
-- rate closes the old row and opens a new one rather than editing it. `valid_to IS NULL` is
-- the open row, which is exactly what every existing reader already looks for.

SET LOCAL ROLE nx_migrator;

GRANT INSERT, UPDATE ON cost_book TO nx_operator;

-- One open cost per (provider, endpoint). Two would make the cost of a call ambiguous, which
-- is the one thing a cost book may never be, and every reader takes ORDER BY valid_from DESC
-- LIMIT 1 on faith today.
CREATE UNIQUE INDEX uq_cost_open ON cost_book (provider, endpoint) WHERE valid_to IS NULL;

COMMENT ON TABLE cost_book IS
  'What one provider call costs us, versioned. A new rate closes the open row and opens another, so a past month stays measurable against the cost that applied to it.';
