-- 0015: the review queue, with maker and checker.
--
-- docs/01-blueprint.md section 5.7: this is what turns the platform from something that
-- shows data into somewhere work is finished, and it is the strongest reason a
-- subscription is renewed. A queue nobody works in is a report.
--
-- decision_note is the single free text field in the entire system, and rule 6 names it
-- explicitly as the one exception. It is a statement about a decision we made, not a
-- statement about the customer's client, which is the line that keeps this product from
-- drifting into being a CRM.
--
-- Four eyes is enforced by the database rather than by the application. An approval that
-- can be given by the same person who made the decision is not a control, and the one
-- time it matters will be the time someone was in a hurry.

SET LOCAL ROLE nx_migrator;

CREATE TABLE review_cases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  entity_id     uuid NOT NULL,
  run_id        uuid NOT NULL,
  status        text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'ASSIGNED', 'DECIDED', 'CLOSED')),
  -- Why it came here. Copied from the decision so the queue is readable without joining
  -- back to a run whose rules may since have changed.
  reason_codes  text[] NOT NULL DEFAULT '{}',
  priority      text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH')),

  assigned_to   text,
  assigned_at   timestamptz,

  -- The maker.
  outcome       text CHECK (outcome IN ('PASS', 'FAIL')),
  decided_by    text,
  decided_at    timestamptz,
  decision_note text,

  -- The checker.
  approved_by   text,
  approved_at   timestamptz,

  sla_due_at    timestamptz NOT NULL,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,

  CONSTRAINT fk_review_entity FOREIGN KEY (tenant_id, entity_id) REFERENCES entities (tenant_id, id),
  CONSTRAINT fk_review_run FOREIGN KEY (tenant_id, run_id) REFERENCES verification_runs (tenant_id, id),

  -- One open case per run. A second verification of the same run does not stack a second
  -- case on an analyst's queue.
  CONSTRAINT uq_review_run UNIQUE (tenant_id, run_id),

  -- Four eyes, in the schema.
  CONSTRAINT ck_review_four_eyes CHECK (
    approved_by IS NULL OR decided_by IS NULL OR approved_by <> decided_by
  ),
  -- A decision needs its maker, its time and its reason together, or none of them.
  CONSTRAINT ck_review_decision_complete CHECK (
    (outcome IS NULL AND decided_by IS NULL AND decided_at IS NULL)
    OR (outcome IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL
        AND decision_note IS NOT NULL AND length(btrim(decision_note)) > 0)
  ),
  -- Nothing is approved before it is decided.
  CONSTRAINT ck_review_approval_after_decision CHECK (
    approved_by IS NULL OR (outcome IS NOT NULL AND approved_at IS NOT NULL)
  ),
  CONSTRAINT ck_review_closed CHECK (
    status <> 'CLOSED' OR (approved_by IS NOT NULL AND closed_at IS NOT NULL)
  )
);

CREATE INDEX ix_review_open ON review_cases (tenant_id, sla_due_at)
  WHERE status IN ('OPEN', 'ASSIGNED');

CREATE INDEX ix_review_awaiting_approval ON review_cases (tenant_id, decided_at)
  WHERE status = 'DECIDED';

CREATE INDEX ix_review_entity ON review_cases (tenant_id, entity_id);

ALTER TABLE review_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON review_cases
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON review_cases TO nx_app;
GRANT SELECT ON review_cases TO nx_retention;

-- How long a case may sit before it is late. Per tenant, because an onboarding queue and
-- a payout queue are not the same urgency.
ALTER TABLE tenants ADD COLUMN review_sla_hours int NOT NULL DEFAULT 48
  CONSTRAINT ck_review_sla CHECK (review_sla_hours > 0);
