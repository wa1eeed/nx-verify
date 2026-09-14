-- 0046: a verification request, and the checks inside it as they run.
--
-- Handoff screen 02. A subscriber ticks the checks for a customer and presses «تحقق من
-- الكل», or presses the button of one check. The screen shows each row move from «قيد
-- المعالجة» to its result, in whatever order the checks finish, and the customer's file
-- fills as each one does. That needs the request to exist before it has run, and each check
-- in it to have a state somebody can read while the others are still going.
--
--   verification_requests         what was asked: the kind of customer, the subject, the
--                                 checks, and the key every check's idempotency key derives
--                                 from (rule 7). A DRAFT is a request saved without running.
--   verification_request_checks   one row per check of a request: queued, running, done,
--                                 failed or skipped, what it ended in, and how many attempts
--                                 it took. A check that could not reach the authority is
--                                 tried again up to its limit, and is never charged (the
--                                 failed attempts wrote runs that cost nothing, guard 04).
--
-- The subject is what the person typed: a unified number, or a national ID and a freelance
-- certificate number, and sometimes an IBAN. Hashed for finding and encrypted for the call
-- to the authority, never stored in the clear (rule 4), with the key version it was sealed
-- under so a rotation can move it. A request for a customer already on file carries the
-- file instead, and its identifiers stay where they are.

SET LOCAL ROLE nx_migrator;

CREATE TABLE verification_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  status          text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'QUEUED', 'RUNNING', 'DONE', 'CANCELLED')),
  kind            text NOT NULL CHECK (kind IN ('COMPANY', 'ESTABLISHMENT', 'FREELANCER')),
  entity_id       uuid,
  subject_type    text CHECK (subject_type IS NULL OR subject_type IN ('UNN', 'NATIONAL_ID', 'IQAMA')),
  subject_hash    bytea,
  subject_enc     bytea,
  certificate_enc bytea,
  iban_enc        bytea,
  key_version     int NOT NULL DEFAULT 1 CHECK (key_version >= 1),
  product_codes   text[] NOT NULL DEFAULT '{}',
  -- The managers a manager check is limited to, pressed from one manager's row of the file.
  -- Null checks every manager the registry named.
  person_ids      uuid[],
  bundle_key      text NOT NULL CHECK (length(bundle_key) BETWEEN 8 AND 60),
  requested_by    uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  submitted_at    timestamptz,
  completed_at    timestamptz,

  CONSTRAINT uq_request_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_request_bundle UNIQUE (tenant_id, bundle_key),
  CONSTRAINT fk_request_entity FOREIGN KEY (tenant_id, entity_id) REFERENCES entities (tenant_id, id),
  -- Something to verify: a customer on file, or a subject to find one by.
  CONSTRAINT ck_request_subject CHECK (
    entity_id IS NOT NULL OR (subject_hash IS NOT NULL AND subject_enc IS NOT NULL)
  ),
  -- A hash and its ciphertext travel together, or not at all.
  CONSTRAINT ck_request_subject_pair CHECK ((subject_hash IS NULL) = (subject_enc IS NULL))
);

CREATE INDEX ix_request_drafts ON verification_requests (tenant_id, created_at DESC)
  WHERE status = 'DRAFT';
CREATE INDEX ix_request_open ON verification_requests (tenant_id, submitted_at)
  WHERE status IN ('QUEUED', 'RUNNING');

ALTER TABLE verification_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON verification_requests
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON verification_requests TO nx_app;
GRANT SELECT, DELETE ON verification_requests TO nx_retention;

CREATE TABLE verification_request_checks (
  tenant_id    uuid NOT NULL,
  request_id   uuid NOT NULL,
  product_code text NOT NULL REFERENCES products(code),
  status       text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED')),
  -- What the last attempt ended in, in the vocabulary of a run.
  outcome      text CHECK (
    outcome IS NULL OR
    outcome IN ('OK', 'PARTIAL', 'NOT_FOUND', 'ERROR', 'SKIPPED', 'REFUSED', 'AWAITING')
  ),
  -- The sentence the screen shows for it, written by the system and never by a person.
  note_ar      text,
  reference    text,
  -- Attempts started. A check whose runner stopped mid-call is taken again under the same
  -- attempt, and so under the same idempotency key, so a call that did finish is replayed
  -- rather than paid for twice.
  attempts     int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts int NOT NULL DEFAULT 2 CHECK (max_attempts BETWEEN 1 AND 5),
  -- When a check that could not reach the authority may be tried again.
  retry_at     timestamptz,
  locked_at    timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, request_id, product_code),
  CONSTRAINT fk_request_check FOREIGN KEY (tenant_id, request_id)
    REFERENCES verification_requests (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_request_checks_open ON verification_request_checks (tenant_id, request_id)
  WHERE status IN ('QUEUED', 'RUNNING');

ALTER TABLE verification_request_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_request_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON verification_request_checks
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON verification_request_checks TO nx_app;
GRANT SELECT, DELETE ON verification_request_checks TO nx_retention;

-- What a subscriber chooses about their own portal. One row per subscriber, created on
-- first write; a subscriber with no row has the defaults.
--
--   show_prices   whether the verification screens show prices to this subscriber's users.
--                 A subscriber may not want the people who run checks to see what each costs
--                 (README, screen 02). Charges are unaffected.
CREATE TABLE tenant_preferences (
  tenant_id   uuid PRIMARY KEY REFERENCES tenants(id),
  show_prices boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON tenant_preferences
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON tenant_preferences TO nx_app;

-- What a check brings back, in the words of the request screen: «الاسم، النشاط، الحالة،
-- رأس المال …». Part of the product, so it is a row like the product's name (rule 8), and a
-- product added later says what it brings without a release.
ALTER TABLE products ADD COLUMN summary_ar text;
