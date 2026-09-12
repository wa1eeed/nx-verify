SET LOCAL ROLE nx_migrator;

DROP POLICY IF EXISTS operator_read ON api_requests;
REVOKE SELECT ON api_requests FROM nx_operator;

DROP POLICY IF EXISTS operator_read ON wallets;
REVOKE SELECT ON wallets FROM nx_operator;
