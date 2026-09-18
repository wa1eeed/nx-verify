-- 0060: what each of the customer's own people may do, one permission at a time.
--
-- Until now a workspace had four roles and three questions to ask about them: may this
-- person decide, approve, administer. Everything else was open to everyone, which meant
-- the accountant who came in to pay an invoice could read the national id of every customer
-- the company had ever verified, and the clerk who runs checks could issue an API key.
--
-- A subscriber is the administrator of their own workspace, and the accounts they hand out
-- are the jobs in their company: somebody in finance, somebody in compliance, and the
-- people who verify customers. So the role becomes a preset for one of those jobs, and the
-- unit that actually grants anything is the capability. An administrator may add a
-- capability to one person or take one away, and that exception is a row here.
--
-- Two tables because they are two different kinds of fact. `role_capabilities` is ours: it
-- changes when a screen is added, which is a deployment, so it arrives in a migration and a
-- test holds it equal to the list in the code. `user_capabilities` belongs to the
-- subscriber, changes on a Tuesday afternoon, and is isolated per tenant like everything
-- else they own.
--
-- The effective set is computed in SQL and not only in TypeScript, because four eyes is
-- enforced by a trigger and a trigger that reads the role column would refuse a review case
-- decided by somebody who was granted `review.decide` as an exception. One answer to «may
-- they», read by both layers.

SET LOCAL ROLE nx_migrator;

-- Two jobs the four original roles could not express: the person who pays and the person
-- who is answerable for the decisions.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('VIEWER', 'ANALYST', 'APPROVER', 'FINANCE', 'COMPLIANCE', 'ADMIN')
);

-- The same two roles have to be sayable by the identity provider mapping, or a customer on
-- single sign on could never put anybody in finance.
ALTER TABLE tenant_idp DROP CONSTRAINT tenant_idp_default_role_check;
ALTER TABLE tenant_idp ADD CONSTRAINT tenant_idp_default_role_check CHECK (
  default_role IN ('VIEWER', 'ANALYST', 'APPROVER', 'FINANCE', 'COMPLIANCE', 'ADMIN')
);

-- The catalogue of permissions. A row per capability so the database can validate a
-- reference to one rather than accepting any string somebody types.
CREATE TABLE capabilities (
  code       text PRIMARY KEY,
  name_ar    text NOT NULL,
  summary_ar text NOT NULL,
  -- Which place in the console it governs, so the screen can group them the way the
  -- navigation does rather than listing fourteen switches in a column.
  area       text NOT NULL,
  -- A capability that spends money is marked, because that is the one an administrator
  -- should think twice about handing out and the screen says so.
  spends     boolean NOT NULL DEFAULT false,
  sort       integer NOT NULL
);

CREATE TABLE role_capabilities (
  role       text NOT NULL CHECK (
    role IN ('VIEWER', 'ANALYST', 'APPROVER', 'FINANCE', 'COMPLIANCE', 'ADMIN')
  ),
  capability text NOT NULL REFERENCES capabilities(code),
  PRIMARY KEY (role, capability)
);

-- Neither table carries a tenant: they are the same for every workspace, like the product
-- catalogue, and rule 2 is about rows that belong to somebody.
GRANT SELECT ON capabilities TO nx_app;
GRANT SELECT ON role_capabilities TO nx_app;

-- The exceptions. `granted` false is a permission taken away from somebody whose preset
-- carries it, and true is one added to somebody whose preset does not: both are exceptions
-- worth seeing on the screen, and storing them as one table means an administrator who
-- changes a person's role keeps the exceptions they deliberately made.
CREATE TABLE user_capabilities (
  tenant_id  uuid NOT NULL,
  user_id    uuid NOT NULL,
  capability text NOT NULL REFERENCES capabilities(code),
  granted    boolean NOT NULL,
  set_by     uuid,
  set_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, capability),
  CONSTRAINT fk_user_capability_user
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE user_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_capabilities FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON user_capabilities
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON user_capabilities TO nx_app;
GRANT SELECT ON user_capabilities TO nx_retention;

-- What one person may actually do: their preset, plus what was added, minus what was taken
-- away. A disabled account holds nothing, which is why disabling one is a complete answer
-- and not a flag some screen has to remember to check.
CREATE FUNCTION app.user_capabilities(p_tenant uuid, p_user uuid)
  RETURNS TABLE (capability text)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT c.code
    FROM users u
    CROSS JOIN capabilities c
   WHERE u.tenant_id = p_tenant
     AND u.id = p_user
     AND u.status = 'active'
     AND NOT EXISTS (
       SELECT 1 FROM user_capabilities uc
        WHERE uc.tenant_id = p_tenant AND uc.user_id = p_user
          AND uc.capability = c.code AND uc.granted = false
     )
     AND (
       EXISTS (
         SELECT 1 FROM role_capabilities rc
          WHERE rc.role = u.role AND rc.capability = c.code
       )
       OR EXISTS (
         SELECT 1 FROM user_capabilities uc
          WHERE uc.tenant_id = p_tenant AND uc.user_id = p_user
            AND uc.capability = c.code AND uc.granted = true
       )
     );
$$;

CREATE FUNCTION app.user_can(p_tenant uuid, p_user uuid, p_capability text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.user_capabilities(p_tenant, p_user) AS a(capability)
     WHERE a.capability = p_capability
  );
$$;

GRANT EXECUTE ON FUNCTION app.user_capabilities(uuid, uuid) TO nx_app;
GRANT EXECUTE ON FUNCTION app.user_can(uuid, uuid, text) TO nx_app;

-- The four eyes guard, asking the new question. The shape is unchanged and so is the
-- separation it protects: what changes is that «may this person decide» now has one answer
-- for the trigger and the screen both.
CREATE OR REPLACE FUNCTION app.review_enforce_roles() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.decided_by IS NOT NULL AND NEW.decided_by IS DISTINCT FROM OLD.decided_by THEN
    IF NOT app.user_can(NEW.tenant_id, NEW.decided_by, 'review.decide') THEN
      RAISE EXCEPTION 'this user may not decide a review case' USING ERRCODE = 'NX005';
    END IF;
  END IF;

  IF NEW.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    IF NOT app.user_can(NEW.tenant_id, NEW.approved_by, 'review.approve') THEN
      RAISE EXCEPTION 'this user may not approve a review case' USING ERRCODE = 'NX005';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- The catalogue. Named for what somebody loses when it is switched off, since that is the
-- question an administrator is actually answering.
INSERT INTO capabilities (code, name_ar, summary_ar, area, spends, sort) VALUES
  ('customers.read', 'عرض العملاء',
   'قائمة العملاء وملفاتهم وما رُصد عنهم', 'customers', false, 10),
  ('verify.run', 'تشغيل التحقق',
   'إرسال طلبات التحقق وملفات التأهيل', 'verify', true, 20),
  ('review.decide', 'البتّ في حالات المراجعة',
   'إصدار قرار قبول أو رفض على حالة مُحالة للمراجعة', 'customers', false, 30),
  ('review.approve', 'اعتماد القرارات',
   'اعتماد ما بتّ فيه غيره. لا يعتمد أحد قراره بنفسه', 'customers', false, 40),
  ('monitoring.manage', 'إدارة المراقبة',
   'إضافة عملاء تحت المراقبة وتغيير وتيرتها', 'customers', true, 50),
  ('share.create', 'مشاركة ملف عميل',
   'إصدار رابط مؤقت بملف عميل لجهة خارجية', 'customers', false, 60),
  ('wallet.read', 'عرض الرصيد والفواتير',
   'الاطلاع على الرصيد والباقة وسجل الفواتير', 'billing', false, 70),
  ('wallet.topup', 'طلب شحن الرصيد',
   'إرسال طلب شراء رصيد أو باقة باسم المنشأة', 'billing', false, 80),
  ('prices.manage', 'إدارة الأسعار والسقوف',
   'تعديل أسعار المنتجات وسقوف الإنفاق', 'billing', false, 90),
  ('rules.manage', 'إدارة قواعد القرار',
   'تعديل قواعد القبول والرفض والإحالة للمراجعة', 'settings', false, 100),
  ('settings.manage', 'إعدادات مساحة العمل',
   'التنبيهات ومدد الصلاحية والمجموعات والدخول الموحّد والخدمات المفعّلة',
   'settings', false, 110),
  ('users.manage', 'إدارة المستخدمين والصلاحيات',
   'إضافة الموظفين وتعطيلهم وتحديد ما يملكه كل منهم', 'settings', false, 120),
  ('developers.manage', 'مفاتيح الربط والـ Webhooks',
   'إصدار مفاتيح الـAPI وإلغاؤها وضبط الـ Webhooks', 'settings', false, 130),
  ('audit.read', 'سجل التدقيق',
   'الاطلاع على سجل ما فعله كل مستخدم ومتى', 'settings', false, 140);

-- The presets, each one a job in a company rather than a tier of seniority.
--
-- Finance has no sight of customers on purpose. Somebody who pays invoices has no business
-- reading the commercial registration and the national id of every company you ever
-- checked, and a platform that hands it to them by default has made a decision on the
-- subscriber's behalf that is not ours to make.
INSERT INTO role_capabilities (role, capability) VALUES
  ('VIEWER', 'customers.read'),
  ('VIEWER', 'wallet.read'),

  ('ANALYST', 'customers.read'),
  ('ANALYST', 'wallet.read'),
  ('ANALYST', 'verify.run'),
  ('ANALYST', 'review.decide'),
  ('ANALYST', 'monitoring.manage'),
  ('ANALYST', 'share.create'),

  ('APPROVER', 'customers.read'),
  ('APPROVER', 'wallet.read'),
  ('APPROVER', 'verify.run'),
  ('APPROVER', 'review.decide'),
  ('APPROVER', 'review.approve'),
  ('APPROVER', 'monitoring.manage'),
  ('APPROVER', 'share.create'),

  ('FINANCE', 'wallet.read'),
  ('FINANCE', 'wallet.topup'),
  ('FINANCE', 'prices.manage'),
  ('FINANCE', 'audit.read'),

  ('COMPLIANCE', 'customers.read'),
  ('COMPLIANCE', 'wallet.read'),
  ('COMPLIANCE', 'review.decide'),
  ('COMPLIANCE', 'review.approve'),
  ('COMPLIANCE', 'monitoring.manage'),
  ('COMPLIANCE', 'rules.manage'),
  ('COMPLIANCE', 'share.create'),
  ('COMPLIANCE', 'audit.read');

-- The administrator is every capability there is, and stays that way as capabilities are
-- added: the one account a subscriber cannot lock themselves out of.
INSERT INTO role_capabilities (role, capability)
  SELECT 'ADMIN', code FROM capabilities;
