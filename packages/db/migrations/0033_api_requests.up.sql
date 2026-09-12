-- 0033: the request log a customer's own engineer needs.
--
-- When an integration misbehaves, the first question is "what did you receive from us",
-- and the platform could not answer it. The audit log records acts rather than calls: it
-- says a verification was created, not that a request arrived, was refused for a missing
-- scope, and took nine milliseconds to say so.
--
-- What is stored is the route rather than the address that was called. A path carries
-- values, and values are the one thing rule 4 says must not reach a log, so
-- /v1/verifications/:id is recorded and never the id in it. The body is never stored at
-- all: it carries the subject.

SET LOCAL ROLE nx_migrator;

CREATE TABLE api_requests (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  api_key_id  uuid,
  -- The identifier we hand back in every error, so a customer quoting one can be found.
  request_id  text NOT NULL,
  method      text NOT NULL,
  -- The route pattern, never the address: /v1/verifications/:id and not the id.
  route       text NOT NULL,
  status      int NOT NULL,
  latency_ms  int NOT NULL CHECK (latency_ms >= 0),
  -- Our error code, never the provider's and never a message.
  error_code  text,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'live')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_api_requests_recent ON api_requests (tenant_id, id DESC);
CREATE INDEX ix_api_requests_failures ON api_requests (tenant_id, id DESC)
  WHERE status >= 400;

ALTER TABLE api_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON api_requests
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT ON api_requests TO nx_app;
-- The retention job clears them on its own schedule: a request log is the fastest growing
-- table in a platform like this and the least valuable after a month.
GRANT SELECT, DELETE ON api_requests TO nx_retention;
