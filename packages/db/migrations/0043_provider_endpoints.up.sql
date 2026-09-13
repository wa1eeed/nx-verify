-- 0043: a provider's endpoint map, as rows.
--
-- Rule 8 says a verification product is rows and not code, and it has held: adding a
-- product needs no deployment. Connecting a provider still did. The address a call goes
-- to, the shape of the envelope it comes back in and the names inside it were all in a
-- TypeScript file, so every new provider, and every time one moved a path, was a release.
--
-- That is the wrong shape for the same reason the addresses were: it changes on a
-- supplier's timetable rather than ours. It also blocks work on a provider whose
-- documentation we do not have yet, which is the situation we are actually in.
--
-- What stays in code is what belongs to us: our field names, our authorities as a
-- fallback, and the adapter that walks an envelope. What moves here is everything that
-- describes somebody else's API.
--
-- Per environment, because a sandbox host and a production host disagree about paths more
-- often than anybody expects, and finding that out in production is the expensive way.

SET LOCAL ROLE nx_migrator;

CREATE TABLE provider_endpoints (
  provider    text NOT NULL REFERENCES provider_catalog(code) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'live')),
  -- The endpoint a product step names. Our word, not theirs.
  endpoint    text NOT NULL,
  method      text NOT NULL DEFAULT 'GET' CHECK (method IN ('GET', 'POST')),
  -- Template. {name} is filled from the step's resolved input.
  path        text NOT NULL,
  -- The official body behind this call. What a subscriber sees (rule 5), never the
  -- provider's own name.
  authority   text NOT NULL,
  -- Where the useful payload sits inside their envelope.
  data_path   text,
  -- Their field names to ours, so step_field_map never moves when a provider changes.
  field_map   jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Nested objects merged in at the top rather than prefixed, so one provider returning
  -- an address nested and another returning it flat both arrive the same way.
  flatten     text[] NOT NULL DEFAULT '{}',
  -- The body template for a POST, by the same {name} rule as the path.
  body_map    jsonb,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, environment, endpoint),
  CONSTRAINT ck_endpoint_path CHECK (path <> ''),
  CONSTRAINT ck_endpoint_body CHECK (method = 'GET' OR body_map IS NOT NULL)
);

-- Reading it is learning provider names and their private API shapes, so no subscriber
-- role may (rule 5).
REVOKE ALL ON provider_endpoints FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider_endpoints TO nx_operator;
-- The application reads it to build the adapter for the call it is about to make.
GRANT SELECT ON provider_endpoints TO nx_app;
