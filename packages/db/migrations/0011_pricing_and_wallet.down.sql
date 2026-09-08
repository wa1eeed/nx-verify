SET LOCAL ROLE nx_migrator;

REVOKE ALL ON wallet_ledger FROM nx_app, nx_retention;
DROP TRIGGER IF EXISTS trg_wallet_ledger_no_update ON wallet_ledger;
DROP POLICY IF EXISTS t_isolation ON wallet_ledger;
DROP TABLE IF EXISTS wallet_ledger;
DROP FUNCTION IF EXISTS app.wallet_ledger_append_only();

REVOKE ALL ON wallets FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON wallets;
DROP TABLE IF EXISTS wallets;

REVOKE ALL ON price_book FROM nx_app, nx_retention;
DROP TRIGGER IF EXISTS trg_price_book_forbid_edit ON price_book;
DROP POLICY IF EXISTS operator_default_prices ON price_book;
DROP POLICY IF EXISTS t_isolation ON price_book;
DROP TABLE IF EXISTS price_book;
DROP FUNCTION IF EXISTS app.price_book_forbid_edit();

REVOKE ALL ON cost_book FROM nx_app;
DROP TABLE IF EXISTS cost_book;
