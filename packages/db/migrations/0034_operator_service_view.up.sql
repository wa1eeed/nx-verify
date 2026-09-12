-- 0034: what support needs to see, and what it still may not.
--
-- Three questions arrive from a customer by phone: are our calls failing, is our balance
-- about to stop us, and is the provider behind our checks healthy. Staff could answer none
-- of them, because every table that knows lives behind a subscriber boundary.
--
-- Guard 02 sorts tables by one question: does a row say what the subscriber bought, or
-- what the subscriber knows? A wallet balance is the first. A request log row is neither:
-- it says what our own service did when they called it, carrying a route, a status and a
-- duration, and no entity, no identifier and no decision. That is telemetry about us, and
-- refusing staff sight of it does not protect a customer from anything; it only means
-- support asks the customer to read their own logs to us over the phone.
--
-- So the operator may read the wallet and the request log, and still may not read a run, a
-- decision, an attestation or an entity. The line has moved once, deliberately, and the
-- argument is written here rather than implied by a grant.

SET LOCAL ROLE nx_migrator;

GRANT SELECT ON wallets TO nx_operator;
CREATE POLICY operator_read ON wallets
  FOR SELECT
  TO nx_operator
  USING (true);

GRANT SELECT ON api_requests TO nx_operator;
CREATE POLICY operator_read ON api_requests
  FOR SELECT
  TO nx_operator
  USING (true);
