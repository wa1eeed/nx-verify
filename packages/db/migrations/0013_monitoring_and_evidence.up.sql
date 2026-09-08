-- 0013: monitoring, change events, evidence and scores.
--
-- docs/01-blueprint.md section 5.6 describes three layers, and the difference between
-- them is the whole commercial model. Freshness and alerts are arithmetic and cost
-- nothing, and they are what create demand for the third. Monitoring is a real
-- re-verification, it spends the customer's balance, and so it is never on by default.
--
-- budget_cap_sar is not negotiable. A monitor draws from a balance automatically, and a
-- surprise invoice ends the relationship faster than any technical failure.

SET LOCAL ROLE nx_migrator;

CREATE TABLE monitors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  entity_id      uuid NOT NULL,
  product_code   text NOT NULL REFERENCES products(code),
  field_paths    text[] NOT NULL,
  cadence        text NOT NULL CHECK (cadence IN ('DAILY', 'WEEKLY', 'MONTHLY', 'ON_EXPIRY')),
  next_run_at    timestamptz NOT NULL,
  budget_cap_sar numeric(10,2) NOT NULL,
  spent_this_period numeric(10,2) NOT NULL DEFAULT 0,
  period_started_at timestamptz NOT NULL DEFAULT date_trunc('month', now()),
  status         text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'budget_exhausted')),
  -- Who switched it on, and under what consent. Both are asked for in an audit, and
  -- neither can be reconstructed later if it was not recorded at the time.
  activated_by   text NOT NULL,
  consent_ref    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_monitors_entity FOREIGN KEY (tenant_id, entity_id) REFERENCES entities (tenant_id, id),
  CONSTRAINT uq_monitors_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT ck_monitor_budget CHECK (budget_cap_sar > 0),
  CONSTRAINT ck_monitor_fields CHECK (cardinality(field_paths) > 0)
);

CREATE INDEX ix_mon_due ON monitors (next_run_at) WHERE status = 'active';

ALTER TABLE monitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitors FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON monitors
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON monitors TO nx_app;
GRANT SELECT ON monitors TO nx_retention;

-- What a change means. Rows, not a switch statement, so a tenant can be given its own
-- severity for a field without a release.
CREATE TABLE change_severity_rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid,
  field_path text NOT NULL,
  from_value jsonb,
  to_value   jsonb,
  severity   text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  seq        int NOT NULL DEFAULT 100,
  reason_ar  text NOT NULL,
  reason_en  text NOT NULL
);

CREATE INDEX ix_change_rules ON change_severity_rules (field_path, seq);

-- The severity table from docs/02-schema.md section 7, seeded before row level security
-- is switched on, so that no running code can edit the defaults every tenant inherits.
INSERT INTO change_severity_rules (tenant_id, field_path, from_value, to_value, severity, seq, reason_ar, reason_en)
VALUES
  (NULL, 'cr.status', '"ACTIVE"'::jsonb, NULL, 'CRITICAL', 10,
   'السجل التجاري لم يعد نشطاً', 'The commercial registration is no longer active'),
  (NULL, 'manager.signing_authority', NULL, NULL, 'CRITICAL', 20,
   'تغيّر المدير المفوّض بالتوقيع', 'The authorised signatory changed'),
  (NULL, 'manager.signing_authority.verified', NULL, 'false'::jsonb, 'CRITICAL', 25,
   'تعذّر إثبات صلاحية التوقيع', 'Signing authority could not be verified'),
  (NULL, 'freelance.document', NULL, NULL, 'CRITICAL', 30,
   'تغيّرت وثيقة العمل الحر', 'The freelance document changed'),
  (NULL, 'iban.ownership', NULL, NULL, 'CRITICAL', 40,
   'تغيّرت ملكية الآيبان', 'IBAN ownership changed'),
  (NULL, 'address.national.city', NULL, NULL, 'WARNING', 50,
   'تغيّر العنوان الوطني', 'The national address changed'),
  (NULL, 'address.national.district', NULL, NULL, 'WARNING', 51,
   'تغيّر العنوان الوطني', 'The national address changed'),
  (NULL, 'cr.core.capital', NULL, NULL, 'WARNING', 60,
   'تغيّر رأس المال', 'Capital changed'),
  (NULL, 'cr.core.name', NULL, NULL, 'WARNING', 61,
   'تغيّر اسم المنشأة', 'The registered name changed');

ALTER TABLE change_severity_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_severity_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON change_severity_rules
  USING (tenant_id IS NULL OR tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON change_severity_rules TO nx_app;
GRANT SELECT ON change_severity_rules TO nx_retention;

CREATE TABLE change_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  entity_id       uuid NOT NULL,
  field_path      text NOT NULL,
  old_attestation uuid,
  new_attestation uuid NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  reason_ar       text,
  reason_en       text,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  notified_at     timestamptz,
  acknowledged_by text,
  acknowledged_at timestamptz,
  CONSTRAINT fk_change_entity FOREIGN KEY (tenant_id, entity_id) REFERENCES entities (tenant_id, id),
  CONSTRAINT fk_change_new FOREIGN KEY (tenant_id, new_attestation) REFERENCES attestations (tenant_id, id),
  CONSTRAINT fk_change_old FOREIGN KEY (tenant_id, old_attestation) REFERENCES attestations (tenant_id, id)
);

CREATE INDEX ix_change_open ON change_events (tenant_id, detected_at DESC)
  WHERE acknowledged_at IS NULL;

ALTER TABLE change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_events FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON change_events
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON change_events TO nx_app;
GRANT SELECT ON change_events TO nx_retention;

CREATE TABLE evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  run_id       uuid NOT NULL,
  storage_key  text NOT NULL,
  content_hash bytea NOT NULL,
  signed_at    timestamptz NOT NULL DEFAULT now(),
  signature    bytea NOT NULL,
  -- Behind the QR code on the document. The page it opens shows the hash and the sealing
  -- time and nothing else: no name, no identifier, no field values. A public verification
  -- page that leaks personal data is worse than no verification page.
  public_token text UNIQUE,
  expires_at   timestamptz,
  CONSTRAINT fk_evidence_run FOREIGN KEY (tenant_id, run_id) REFERENCES verification_runs (tenant_id, id),
  CONSTRAINT ck_evidence_hash CHECK (octet_length(content_hash) = 32)
);

CREATE INDEX ix_evidence_run ON evidence (tenant_id, run_id);

ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON evidence
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT ON evidence TO nx_app;
GRANT SELECT, DELETE ON evidence TO nx_retention;

-- The public verification lookup, like the API key lookup, cannot be tenant scoped: the
-- token is presented by someone who has no account. It returns the hash and the sealing
-- time, and there is no column here that could carry anything else.
CREATE FUNCTION app.resolve_evidence_token(token text)
  RETURNS TABLE (content_hash bytea, signed_at timestamptz, expires_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT e.content_hash, e.signed_at, e.expires_at
  FROM evidence e
  WHERE e.public_token = token
    AND (e.expires_at IS NULL OR e.expires_at > now())
  LIMIT 1;
$$;

GRANT SELECT ON evidence TO nx_auth;
CREATE POLICY evidence_public_lookup ON evidence
  FOR SELECT
  TO nx_auth
  USING (public_token IS NOT NULL);

GRANT CREATE ON SCHEMA app TO nx_auth;
ALTER FUNCTION app.resolve_evidence_token(text) OWNER TO nx_auth;
REVOKE CREATE ON SCHEMA app FROM nx_auth;
REVOKE ALL ON FUNCTION app.resolve_evidence_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_evidence_token(text) TO nx_app;

CREATE TABLE entity_scores (
  tenant_id   uuid NOT NULL,
  entity_id   uuid NOT NULL,
  score       int NOT NULL CHECK (score >= 0 AND score <= 100),
  -- Not optional. A score without its working is refused by risk management, and with it
  -- goes the entire commercial value of having one.
  breakdown   jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity_id),
  CONSTRAINT fk_scores_entity FOREIGN KEY (tenant_id, entity_id) REFERENCES entities (tenant_id, id)
);

ALTER TABLE entity_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_scores FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON entity_scores
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON entity_scores TO nx_app;
GRANT SELECT ON entity_scores TO nx_retention;


-- The retention job destroys and then records the destruction, which is the half of the
-- promise a regulator actually cares about. It therefore needs to write the audit log,
-- to remove the identifiers that are the personal data, and to archive what is left.
GRANT INSERT ON audit_log TO nx_retention;
GRANT DELETE ON entity_identifiers TO nx_retention;
GRANT UPDATE (archived_at) ON entities TO nx_retention;
