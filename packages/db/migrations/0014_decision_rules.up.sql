-- 0014: the decision.
--
-- docs/01-blueprint.md section 1: competitors answer "is this company real". We answer
-- "who is it, who stands behind it, what changed, and is your earlier decision still
-- correct". The decision column is where the fourth part of that sentence lives, and it
-- has been null until now.
--
-- docs/03-products.md section 7: rules are evaluated in order and the first match
-- decides. tenant_id is what makes this defensible commercially: a bank and an insurer
-- can reach different conclusions from the same facts on the same product, and that is
-- the part no data provider can sell.

SET LOCAL ROLE nx_migrator;

CREATE TABLE decision_rulesets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid,
  code       text NOT NULL,
  name_ar    text NOT NULL,
  name_en    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_ruleset_code
  ON decision_rulesets (
    (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    code
  );

CREATE TABLE decision_rules (
  ruleset_id  uuid NOT NULL REFERENCES decision_rulesets(id) ON DELETE CASCADE,
  seq         int NOT NULL,
  -- A closed set of conditions, not an expression language. A rule is a lookup and a
  -- comparison, deliberately: anything richer would be a program in a table, and a
  -- program in a table is code that never gets reviewed, tested or deployed.
  condition   jsonb NOT NULL,
  outcome     text NOT NULL CHECK (outcome IN ('PASS', 'FAIL', 'REVIEW')),
  reason_code text NOT NULL,
  reason_ar   text NOT NULL,
  reason_en   text NOT NULL,
  PRIMARY KEY (ruleset_id, seq)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON decision_rulesets, decision_rules TO nx_app;
GRANT SELECT ON decision_rulesets, decision_rules TO nx_retention;

-- The default set from docs/03-products.md section 7, seeded before row level security so
-- that no tenant can edit the defaults every other tenant inherits.
INSERT INTO decision_rulesets (id, tenant_id, code, name_ar, name_en) VALUES
  ('1c9b0000-0000-4000-8000-000000000001'::uuid, NULL, 'KYB_DEFAULT',
   'قواعد التحقق الشامل الافتراضية', 'Default business verification rules');

INSERT INTO decision_rules (ruleset_id, seq, condition, outcome, reason_code, reason_ar, reason_en) VALUES
  ('1c9b0000-0000-4000-8000-000000000001'::uuid, 1,
   '{"op":"ne","field":"cr.status","value":"ACTIVE"}'::jsonb,
   'FAIL', 'CR_NOT_ACTIVE',
   'السجل التجاري غير نشط', 'The commercial registration is not active'),

  ('1c9b0000-0000-4000-8000-000000000001'::uuid, 2,
   '{"op":"eq","field":"manager.signing_authority.verified","value":false}'::jsonb,
   'REVIEW', 'SIGNING_AUTHORITY_UNVERIFIED',
   'تعذّر إثبات صلاحية التوقيع', 'Signing authority could not be verified'),

  ('1c9b0000-0000-4000-8000-000000000001'::uuid, 3,
   '{"op":"missing","field":"address.national.city"}'::jsonb,
   'REVIEW', 'ADDRESS_UNAVAILABLE',
   'العنوان الوطني غير متوفر', 'The national address is not available'),

  -- Staleness is a decision input, not only a display state. A registration status we
  -- last saw four months ago is not evidence that it is active today.
  ('1c9b0000-0000-4000-8000-000000000001'::uuid, 4,
   '{"op":"stale","field":"cr.status"}'::jsonb,
   'REVIEW', 'CR_STATUS_STALE',
   'حالة السجل التجاري قديمة وتحتاج إعادة تحقق',
   'The registration status is stale and needs re-verification'),

  -- The network signal. One person authorised to sign for several companies is not
  -- wrongdoing, and it is not nothing either. It is a reason for a human to look.
  ('1c9b0000-0000-4000-8000-000000000001'::uuid, 5,
   '{"op":"linked_gte","relation":"MANAGES","value":3}'::jsonb,
   'REVIEW', 'NETWORK_SIGNAL',
   'المدير مرتبط بأكثر من ثلاثة كيانات', 'The manager is linked to more than three entities'),

  ('1c9b0000-0000-4000-8000-000000000001'::uuid, 99,
   '{"op":"always"}'::jsonb,
   'PASS', 'REQUIREMENTS_MET',
   'استوفى المتطلبات', 'Requirements met');

ALTER TABLE decision_rulesets ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_rulesets FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON decision_rulesets
  USING (tenant_id IS NULL OR tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- decision_rules carries no tenant_id of its own: it belongs to a ruleset, and the
-- ruleset carries the tenant. Guard 02 enumerates tables that carry tenant_id, so this
-- one is correctly outside its scope, and reaching a rule still requires reaching its
-- ruleset first.
ALTER TABLE decision_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON decision_rules
  USING (
    EXISTS (
      SELECT 1 FROM decision_rulesets r
      WHERE r.id = ruleset_id
        AND (r.tenant_id IS NULL OR r.tenant_id = app.current_tenant())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM decision_rulesets r
      WHERE r.id = ruleset_id AND r.tenant_id = app.current_tenant()
    )
  );

-- Products point at a ruleset. The column has existed since migration 0009 and is now
-- given its reference.
ALTER TABLE products
  ADD CONSTRAINT fk_products_ruleset
  FOREIGN KEY (decision_ruleset) REFERENCES decision_rulesets(id);

-- Which product uses which ruleset is seed data, not schema. Setting it here would touch
-- rows that do not exist yet, because the catalogue is seeded after migrations run.
