-- 0052: the risk model as rows, tunable per platform and per subscriber.
--
-- Everything the risk score is made of has been a TypeScript literal in one module since it was
-- written: twelve weights, the two bands that turn a score into «عالية» or «متوسطة», and five
-- thresholds buried inside the conditions (a business is new under 180 days, a manager is worth
-- noticing at three other companies, an address shared with one other customer counts).
--
-- That was right while nobody had an opinion. It stops being right the moment two subscribers
-- have different ones, and they do: a bank's tolerance for «this manager also manages four other
-- companies» is not a marketplace's. Shipping a release to change a number for one customer is
-- not a risk model, it is a deployment pipeline with a number in it.
--
-- So the model becomes rows, on the same shape as everything else here (rule 8):
--
--   risk_signals          what the platform believes, one row per signal
--   tenant_risk_signals   what one subscriber believes instead, per signal, NULL means inherit
--   tenant_risk_settings  the bands for one subscriber, NULL means inherit
--
-- Inheritance is by reference, never by copy. Nothing is written onto a subscriber when they are
-- created, so a year later «they chose thirty» is still distinguishable from «thirty was the
-- default that March», and improving a default reaches everybody who never disagreed with it.
--
-- The defaults below are the exact values the code carried, so applying this migration changes
-- no score anywhere. That is the point: a refactor that moves a number must not move the number.

SET LOCAL ROLE nx_migrator;

-- ── the bands ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE platform_settings
  ADD COLUMN risk_high_from   int NOT NULL DEFAULT 60 CHECK (risk_high_from BETWEEN 1 AND 100),
  ADD COLUMN risk_medium_from int NOT NULL DEFAULT 30 CHECK (risk_medium_from BETWEEN 1 AND 100),
  ADD CONSTRAINT ck_risk_bands_ordered CHECK (risk_medium_from < risk_high_from);

COMMENT ON COLUMN platform_settings.risk_high_from IS
  'A score at or above this reads as «عالية». Below the medium band it reads as «منخفضة».';

-- ── what the platform believes ────────────────────────────────────────────────────────────

CREATE TABLE risk_signals (
  code       text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name_ar    text NOT NULL CHECK (length(name_ar) BETWEEN 2 AND 80),
  -- What kind of doubt it is, which is how the panel groups them and how an owner reasons
  -- about the model: status from an authority, a mismatch between two answers, a link to
  -- another customer, a gap in the file, a change nobody has read, or simple youth.
  category   text NOT NULL CHECK (
    category IN ('STATUS', 'MISMATCH', 'INTERSECTION', 'INCOMPLETE', 'CHANGE', 'AGE')
  ),
  severity   text NOT NULL CHECK (severity IN ('HIGH', 'MEDIUM', 'LOW')),
  weight     int NOT NULL CHECK (weight BETWEEN 0 AND 100),
  enabled    boolean NOT NULL DEFAULT true,
  -- The one number the condition compares against, where it has one. Its meaning differs per
  -- signal, so it carries its own label rather than being named in the code.
  threshold  numeric CHECK (threshold IS NULL OR threshold >= 0),
  threshold_label_ar text CHECK (threshold_label_ar IS NULL OR length(threshold_label_ar) <= 80),
  -- The verification service whose answers this signal reads. It is what lets an owner switch
  -- risk scoring off for one service and have every signal that depends on it go with it.
  -- NULL for a signal that reads no single service: a gap in the file, or an unread change.
  --
  -- No foreign key, deliberately, for the same reason provider_usage has none: the catalogue
  -- is a seed rather than a migration, so a database that has been migrated and not yet seeded
  -- has no products at all, and a risk model that cannot be written until the catalogue exists
  -- is a risk model that cannot ship with the schema. The panel checks the code when staff
  -- edit it; a code that names nothing simply groups under no service.
  product_code text,
  position   int NOT NULL CHECK (position > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  -- A label without a number, or a number without a label, is half a setting.
  CONSTRAINT ck_risk_threshold_labelled CHECK ((threshold IS NULL) = (threshold_label_ar IS NULL))
);

COMMENT ON TABLE risk_signals IS
  'What raises a customer risk score, and by how much. The platform default; a subscriber may disagree per signal.';

REVOKE ALL ON risk_signals FROM PUBLIC;
GRANT SELECT ON risk_signals TO nx_app, nx_retention;
GRANT SELECT, INSERT, UPDATE ON risk_signals TO nx_operator;

-- ── what one subscriber believes instead ──────────────────────────────────────────────────

CREATE TABLE tenant_risk_signals (
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  signal_code text NOT NULL REFERENCES risk_signals (code) ON DELETE CASCADE,
  -- Each NULL inherits the platform's answer for that one thing, so a subscriber may disagree
  -- about a weight without freezing a threshold they never had an opinion about.
  enabled     boolean,
  weight      int CHECK (weight IS NULL OR weight BETWEEN 0 AND 100),
  threshold   numeric CHECK (threshold IS NULL OR threshold >= 0),
  decided_at  timestamptz NOT NULL DEFAULT now(),
  decided_by  text,
  note        text CHECK (note IS NULL OR length(note) <= 200),
  PRIMARY KEY (tenant_id, signal_code),
  -- A row that overrides nothing is a row that should not exist: lifting the last opinion
  -- deletes it, so «inherited» is the absence of a row rather than three nulls.
  CONSTRAINT ck_tenant_signal_says_something
    CHECK (enabled IS NOT NULL OR weight IS NOT NULL OR threshold IS NOT NULL)
);

ALTER TABLE tenant_risk_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_risk_signals FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON tenant_risk_signals
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

REVOKE ALL ON tenant_risk_signals FROM PUBLIC;
-- The subscriber's own screens read it to explain a score. Only staff decide it: a customer
-- who sets their own risk thresholds is a customer marking their own examination.
GRANT SELECT ON tenant_risk_signals TO nx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_risk_signals TO nx_operator;
CREATE POLICY operator_manage ON tenant_risk_signals
  TO nx_operator USING (true) WITH CHECK (true);

CREATE TABLE tenant_risk_settings (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  risk_high_from   int CHECK (risk_high_from IS NULL OR risk_high_from BETWEEN 1 AND 100),
  risk_medium_from int CHECK (risk_medium_from IS NULL OR risk_medium_from BETWEEN 1 AND 100),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text,
  CONSTRAINT ck_tenant_risk_bands_ordered CHECK (
    risk_medium_from IS NULL OR risk_high_from IS NULL OR risk_medium_from < risk_high_from
  )
);

ALTER TABLE tenant_risk_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_risk_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON tenant_risk_settings
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

REVOKE ALL ON tenant_risk_settings FROM PUBLIC;
GRANT SELECT ON tenant_risk_settings TO nx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_risk_settings TO nx_operator;
CREATE POLICY operator_manage ON tenant_risk_settings
  TO nx_operator USING (true) WITH CHECK (true);

-- ── the model as it stands today, to the number ───────────────────────────────────────────

INSERT INTO risk_signals
  (code, name_ar, category, severity, weight, threshold, threshold_label_ar, product_code, position)
VALUES
  ('liquidation', 'المنشأة تحت التصفية', 'STATUS', 'HIGH', 70,
   NULL, NULL, 'CR_FULL', 10),
  ('certificate_not_owned', 'وثيقة العمل الحر لا تعود لصاحب الهوية', 'MISMATCH', 'HIGH', 65,
   NULL, NULL, 'FREELANCE_CERTIFICATE', 20),
  ('registry_inactive', 'السجل التجاري غير فعّال', 'STATUS', 'HIGH', 60,
   NULL, NULL, 'CR_FULL', 30),
  ('iban_mismatch', 'الحساب البنكي مسجل باسم آخر', 'MISMATCH', 'HIGH', 60,
   NULL, NULL, 'IBAN_VERIFICATION', 40),
  ('certificate_inactive', 'وثيقة العمل الحر غير سارية', 'STATUS', 'HIGH', 60,
   NULL, NULL, 'FREELANCE_CERTIFICATE', 50),
  ('shared_account', 'الحساب البنكي نفسه مقدَّم إلى عملاء آخرين', 'INTERSECTION', 'HIGH', 60,
   1, 'يبدأ العدّ من عميل آخر', 'IBAN_VERIFICATION', 60),
  ('iban_partial', 'تطابق جزئي بين الاسم واسم صاحب الحساب', 'MISMATCH', 'MEDIUM', 30,
   NULL, NULL, 'IBAN_VERIFICATION', 70),
  ('account_inactive', 'الحساب البنكي غير نشط', 'STATUS', 'MEDIUM', 30,
   NULL, NULL, 'IBAN_VERIFICATION', 80),
  ('manager_many_companies', 'مدير يدير عدة شركات من عملائك', 'INTERSECTION', 'MEDIUM', 30,
   3, 'عدد الشركات الأخرى', 'MANAGER_AUTHORITY', 90),
  ('open_changes', 'تغيّرات مرصودة بانتظار الاطلاع', 'CHANGE', 'MEDIUM', 30,
   1, 'يبدأ العدّ من تغيّر واحد', NULL, 100),
  ('shared_address', 'العنوان الوطني نفسه مسجل لعملاء آخرين', 'INTERSECTION', 'LOW', 14,
   1, 'يبدأ العدّ من عميل آخر', 'NATIONAL_ADDRESS', 110),
  ('new_business', 'منشأة حديثة التأسيس', 'AGE', 'LOW', 10,
   180, 'عمر السجل بالأيام', 'CR_FULL', 120),
  -- Counted per unfilled required section rather than once, and capped, because a file missing
  -- five sections is not five times riskier than one missing a section: it is a file nobody
  -- has finished reading yet.
  ('incomplete_section', 'قسم مطلوب لم يكتمل بعد', 'INCOMPLETE', 'LOW', 10,
   3, 'أكثر عدد أقسام تُحتسب', NULL, 130);

RESET ROLE;
