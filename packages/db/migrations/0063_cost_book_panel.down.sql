-- Undo 0063. The panel goes back to reading costs it cannot write.

SET LOCAL ROLE nx_migrator;

DROP INDEX IF EXISTS uq_cost_open;
REVOKE INSERT, UPDATE ON cost_book FROM nx_operator;
