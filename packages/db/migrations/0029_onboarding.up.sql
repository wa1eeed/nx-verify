-- 0029: the case, which is what turns verification into onboarding.
--
-- Everything before this answers "is this fact true". A company deciding whether to take
-- on a merchant is asking something else: is this applicant acceptable, what did we check
-- before we said so, who said it, when, and what is still outstanding. Those questions
-- are about a file that moves through states, and the platform had no object for one.
--
-- Runs, decisions, review cases and portfolios all exist. What was missing is the thing
-- that gathers them: a case knows which checks this kind of applicant requires, which of
-- them are done, what each concluded, who waived one and why, when it is due, and what
-- the whole file finally decided.
--
-- Rule 8 holds here as everywhere: which checks an onboarding requires are rows, so a
-- customer adds a journey without a deployment. Rule 6 holds too, which is why a waiver
-- carries a code from a closed set rather than a sentence somebody typed: the single
-- exception for free text in this platform is review_cases.decision_note, and this is not
-- it.

SET LOCAL ROLE nx_migrator;

CREATE TABLE onboarding_journeys (
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  code             text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  name_ar          text NOT NULL,
  description_ar   text,
  -- How long a case of this kind may sit before it counts as late.
  sla_hours        int NOT NULL DEFAULT 48 CHECK (sla_hours > 0),
  -- The rules that judge the file once its checks are done. Null falls back to the
  -- product's ruleset, exactly as a portfolio does.
  decision_ruleset uuid,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, code)
);

ALTER TABLE onboarding_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_journeys FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON onboarding_journeys
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_journeys TO nx_app;

-- Which checks a journey requires, in order.
CREATE TABLE onboarding_journey_steps (
  tenant_id    uuid NOT NULL,
  journey_code text NOT NULL,
  step_key     text NOT NULL,
  seq          int NOT NULL,
  product_code text NOT NULL REFERENCES products(code),
  -- An optional check is one the file can close without. A required one is not.
  required     boolean NOT NULL DEFAULT true,
  -- When this step applies at all, in the same condition language the decision engine
  -- uses. A journey for limited companies and one for freelancers differ by which steps
  -- apply, and expressing that as a condition means the two are one journey when the
  -- customer wants them to be and two when they do not.
  applies_when jsonb,
  -- Which parts of the applicant record this check is given.
  --
  -- Each product declares its own input schema and several refuse anything they did not
  -- ask for, which is deliberate: a malformed request must cost nothing. So the journey
  -- says what to hand each check, in the same spirit as a provider step's input binding.
  -- Absent means hand it the whole record.
  subject_map  jsonb,
  PRIMARY KEY (tenant_id, journey_code, step_key),
  CONSTRAINT fk_journey FOREIGN KEY (tenant_id, journey_code)
    REFERENCES onboarding_journeys (tenant_id, code) ON DELETE CASCADE
);

ALTER TABLE onboarding_journey_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_journey_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON onboarding_journey_steps
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_journey_steps TO nx_app;

/**
 * The file itself.
 *
 * Its states are the states a person would describe on a call: it is being worked on, it
 * is waiting for the applicant, it is with a reviewer, it is decided. A case that has
 * closed records who closed it, because an onboarding decision is the kind somebody is
 * asked about a year later.
 */
CREATE TABLE onboarding_cases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  journey_code text NOT NULL,
  entity_id    uuid,
  -- The number a person reads out loud, per subscriber, as run references are.
  reference    text,
  status       text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (
    status IN ('IN_PROGRESS', 'AWAITING_INPUT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN')
  ),
  outcome      text CHECK (outcome IN ('PASS', 'FAIL', 'REVIEW')),
  client_ref   text,
  opened_by    uuid,
  closed_by    uuid,
  opened_at    timestamptz NOT NULL DEFAULT now(),
  due_at       timestamptz NOT NULL,
  closed_at    timestamptz,
  CONSTRAINT uq_case_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_case_journey FOREIGN KEY (tenant_id, journey_code)
    REFERENCES onboarding_journeys (tenant_id, code),
  CONSTRAINT fk_case_entity FOREIGN KEY (tenant_id, entity_id) REFERENCES entities (tenant_id, id),
  -- A closed case has a closing time and an outcome; an open one has neither. Without
  -- this, "approved" and "still open" become a matter of which column you read.
  CONSTRAINT ck_case_closed CHECK (
    (status IN ('APPROVED', 'REJECTED', 'WITHDRAWN')) = (closed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_case_reference ON onboarding_cases (tenant_id, reference)
  WHERE reference IS NOT NULL;
CREATE INDEX ix_cases_open ON onboarding_cases (tenant_id, due_at)
  WHERE closed_at IS NULL;

ALTER TABLE onboarding_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON onboarding_cases
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON onboarding_cases TO nx_app;
GRANT SELECT ON onboarding_cases TO nx_retention;

-- One row per check the case requires, and what became of it.
CREATE TABLE onboarding_case_steps (
  tenant_id    uuid NOT NULL,
  case_id      uuid NOT NULL,
  step_key     text NOT NULL,
  seq          int NOT NULL,
  product_code text NOT NULL REFERENCES products(code),
  required     boolean NOT NULL DEFAULT true,
  status       text NOT NULL DEFAULT 'PENDING' CHECK (
    -- NOT_APPLICABLE is the platform's own answer and carries no waiver: nobody decided
    -- to skip it, the applicant simply is not the kind of applicant it asks about.
    status IN ('PENDING', 'DONE', 'FAILED', 'WAIVED', 'NOT_APPLICABLE')
  ),
  applies_when jsonb,
  subject_map  jsonb,
  run_id       uuid,
  -- Rule 6: a closed set, not a sentence. A waiver that can say anything is a waiver
  -- nobody can report on, and this platform has exactly one free text field by design.
  waive_reason text CHECK (
    waive_reason IS NULL OR waive_reason IN (
      'ALREADY_VERIFIED_ELSEWHERE', 'NOT_APPLICABLE', 'DOCUMENT_ON_FILE', 'RISK_ACCEPTED'
    )
  ),
  waived_by    uuid,
  decided_at   timestamptz,
  PRIMARY KEY (tenant_id, case_id, step_key),
  CONSTRAINT fk_case_step_case FOREIGN KEY (tenant_id, case_id)
    REFERENCES onboarding_cases (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_case_step_run FOREIGN KEY (tenant_id, run_id)
    REFERENCES verification_runs (tenant_id, id),
  -- A waiver names who granted it and why. Both, or neither.
  CONSTRAINT ck_waiver CHECK (
    (status = 'WAIVED') = (waive_reason IS NOT NULL AND waived_by IS NOT NULL)
  )
);

ALTER TABLE onboarding_case_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_case_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON onboarding_case_steps
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON onboarding_case_steps TO nx_app;
GRANT SELECT ON onboarding_case_steps TO nx_retention;

-- Cases share the run counter's shape but not its sequence: a subscriber counts its
-- onboardings separately from its verifications, because they are different questions.
CREATE TABLE case_counters (
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  year       int NOT NULL,
  next_value int NOT NULL DEFAULT 1 CHECK (next_value > 0),
  PRIMARY KEY (tenant_id, year)
);

ALTER TABLE case_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON case_counters
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON case_counters TO nx_app;
