-- 0069: the answer a repeated request gets back, for every POST and not one of them.
--
-- Rule 7 says every POST accepts `Idempotency-Key` and honours it. One endpoint did.
-- `verification_runs` carries the key in a unique index, so a repeated verification is
-- replayed by the run record itself, and every other POST ignored the header entirely:
-- opening an onboarding file, advancing it, creating and confirming a batch, starting a
-- monitor. Six of them spend the subscriber's money. A network timeout on the customer's
-- side, the retry every sane HTTP client then makes, and the platform opened a second file
-- and charged for it a second time.
--
-- This table is the request level record the run record could never be: it belongs to the
-- HTTP layer, not to verification, so it covers a POST that creates a portfolio as
-- naturally as one that calls a provider (ADR-183).
--
-- What is not stored here is the request body. It carries the subject, and the subject
-- carries a national id (rule 4). What is stored is an HMAC over the canonical form of
-- the method, the route, its path parameters and the body, keyed with the workspace's own
-- hmac key, which is enough to answer the only question asked of it: is this the same
-- request as the one that claimed this key, or a different one wearing the same key. The
-- key version is stored beside it, because a rotation must not turn a legitimate retry
-- into a refusal (ADR-045).
--
-- The response body is stored, because replaying it is the whole point. It is our own
-- envelope, the one the subscriber already holds a copy of, and every identifier in a
-- public API response is masked before it is written (ADR-127), so no clear identifier
-- reaches this column.

SET LOCAL ROLE nx_migrator;

CREATE TABLE idempotent_requests (
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  -- The route pattern, never the address: /v1/batches/:id/confirm and not the batch id.
  -- Rule 7 scopes the key to the endpoint, so the same key sent to /v1/batches and to
  -- /v1/monitors is two requests and not one. The id in the path is not lost by this: it
  -- is inside the fingerprint, so the same key aimed at a different batch is refused as
  -- the different request it is.
  route           text NOT NULL CHECK (length(route) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 255),
  -- HMAC-SHA256, hex. Never the body it was taken over.
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  key_version     int NOT NULL,
  status          text NOT NULL CHECK (status IN ('IN_FLIGHT', 'COMPLETED')),
  -- The answer, byte for byte, so a replay is the same answer and not a second one that
  -- resembles it.
  response_status int CHECK (response_status BETWEEN 100 AND 599),
  response_body   text,
  response_content_type text,
  claimed_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  -- How long the platform promises to remember this answer. After it, the key is free
  -- again and the row is a row the retention job may delete.
  expires_at      timestamptz NOT NULL,

  -- Per workspace before anything else (rule 2). Two subscribers who both send the key
  -- "1" are two requests, and the primary key says so rather than a WHERE clause.
  PRIMARY KEY (tenant_id, route, idempotency_key),

  -- A completed record that cannot answer is worse than no record: it would replay an
  -- empty body with no status and the caller would read it as the platform's answer.
  CONSTRAINT ck_idempotent_completed CHECK (
    status <> 'COMPLETED'
    OR (response_status IS NOT NULL AND response_body IS NOT NULL
        AND response_content_type IS NOT NULL AND completed_at IS NOT NULL)
  ),
  -- And a claim still in flight holds no answer at all, so a reader can never mistake a
  -- half written row for a finished one.
  CONSTRAINT ck_idempotent_in_flight CHECK (
    status <> 'IN_FLIGHT'
    OR (response_status IS NULL AND response_body IS NULL
        AND response_content_type IS NULL AND completed_at IS NULL)
  )
);

-- For the retention pass that clears what has aged out. Written now rather than later
-- because the table has one growth pattern and it is time.
CREATE INDEX ix_idempotent_requests_expiry ON idempotent_requests (expires_at);

ALTER TABLE idempotent_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotent_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON idempotent_requests
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

REVOKE ALL ON idempotent_requests FROM PUBLIC;
-- The application claims a key, records the answer on it, and lets it go when the request
-- failed and nothing happened. UPDATE is also how an abandoned claim is taken over: a
-- process that died mid request would otherwise hold a key for ever, and a client retrying
-- with the same key would be refused for ever with it.
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotent_requests TO nx_app;
GRANT SELECT, DELETE ON idempotent_requests TO nx_retention;
