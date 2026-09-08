# NX Verify — مخطط قاعدة البيانات

**الإصدار 1.0 · PostgreSQL 15+**

المبدأ الحاكم: لا يُحدَّث سجل حقيقة أبداً. كل معرفة جديدة تُضاف كإفادة (attestation) جديدة، والملف الشخصي هو إسقاط محسوب لأحدث إفادة صالحة لكل حقل.

---

## 0. المبادئ الخمسة

| # | المبدأ | الأثر |
|---|--------|-------|
| 1 | **Append-only للحقائق** | جدول `attestations` لا يقبل UPDATE ولا DELETE إلا عبر مهمة الاحتفاظ |
| 2 | **عزل المستأجر بالقوة** | `tenant_id` في كل جدول + Row Level Security مفعّل |
| 3 | **التسعير مؤرّخ** | لا تُعدَّل الأسعار، تُقفل نسخة وتُفتح أخرى |
| 4 | **المزود مخفي** | لا يظهر اسم المزود في أي مخرَج للعميل النهائي |
| 5 | **كل شيء قابل للتتبع** | كل صف مشتق يشير إلى `attestation_id` الذي أنتجه |

---

## 1. الأساس: المستأجرون والمزودون

```sql
CREATE TABLE tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name      text NOT NULL,
  cr_number       text,
  status          text NOT NULL DEFAULT 'active',
  data_region     text NOT NULL DEFAULT 'ksa',
  retention_days  int  NOT NULL DEFAULT 1825,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_provider_binding (
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  provider        text NOT NULL,
  mode            text NOT NULL CHECK (mode IN ('MANAGED','BYOC')),
  credential_ref  text,
  rate_limit_rps  int  NOT NULL DEFAULT 5,
  health_status   text NOT NULL DEFAULT 'unknown',
  last_tested_at  timestamptz,
  activated_at    timestamptz,
  PRIMARY KEY (tenant_id, provider)
);
```

**`credential_ref` مؤشر إلى KMS، لا القيمة نفسها.** لا تُخزَّن اعتمادات في قاعدة البيانات بأي شكل، ولا في النسخ الاحتياطية، ولا في السجلات.

**`mode` على مستوى (مستأجر × مزود) لا على مستوى المستأجر.** عميل واحد قد يكون MANAGED على مزود وBYOC على آخر.

---

## 2. الكيانات وحلّ الهوية

```sql
CREATE TABLE entities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  entity_type   text NOT NULL,
    -- BUSINESS | PERSON | FREELANCER | BANK_ACCOUNT | PROPERTY
  display_name  text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz
);

CREATE TABLE entity_identifiers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  entity_id   uuid NOT NULL REFERENCES entities(id),
  id_type     text NOT NULL,
    -- CR | UNN | NATIONAL_ID | IQAMA | FREELANCE_DOC | IBAN | REAL_ESTATE_NO
  id_value_hash bytea NOT NULL,
  id_value_enc  bytea NOT NULL,
  is_primary  boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX uq_ident
  ON entity_identifiers (tenant_id, id_type, id_value_hash);
```

**لماذا `hash` و`enc` معاً:** الهاش (HMAC-SHA256 بمفتاح لكل مستأجر) للبحث والمطابقة والفهرسة، والمشفّر للعرض. رقم الهوية الوطنية لا يُخزَّن نصاً صريحاً في أي مكان.

**قاعدة حلّ الهوية:** أي معرّف يُطابق كياناً قائماً لنفس المستأجر يُدمج فيه. الكيان يُنشأ فقط عند عدم وجود مطابقة. هذا ما يمنع تكرار نفس المنشأة عشر مرات.

---

## 3. قلب النظام: الإفادات

```sql
CREATE TABLE attestations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  entity_id     uuid NOT NULL REFERENCES entities(id),
  field_path    text NOT NULL,
  value         jsonb NOT NULL,
  value_hash    bytea NOT NULL,
  source        text NOT NULL,
  authority     text,
  run_id        uuid NOT NULL,
  observed_at   timestamptz NOT NULL,
  valid_from    timestamptz NOT NULL,
  valid_until   timestamptz,
  confidence    numeric(4,3) NOT NULL DEFAULT 1.000,
  superseded_by uuid REFERENCES attestations(id),
  evidence_id   uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_att_latest
  ON attestations (tenant_id, entity_id, field_path, observed_at DESC);

CREATE INDEX ix_att_expiry
  ON attestations (tenant_id, valid_until)
  WHERE superseded_by IS NULL;
```

### شرح الحقول الحرجة

| الحقل | لماذا |
|-------|-------|
| `field_path` | مسار منقّط: `cr.status`, `address.national`, `manager.signing_authority`, `iban.ownership` |
| `value_hash` | يُستخدم لكشف التغيّر بمقارنة رخيصة بدل مقارنة JSONB كاملة |
| `authority` | الجهة الرسمية مصدر البيانات، منفصلة عن `source` (المزود). العميل يرى `authority` فقط |
| `valid_until` | محسوب من سياسة الحداثة، أو من تاريخ انتهاء فعلي مثل وثيقة العمل الحر |
| `superseded_by` | يشير للإفادة الأحدث. **لا يُحذف الصف القديم أبداً** |
| `confidence` | أقل من 1 عند المطابقة بالاسم، أو عند بيانات جزئية |

### قيود منع التحديث

طبقتان، لا واحدة. الصلاحيات تجعل العملية غير متاحة، والمحفزات تجعلها خطأ.

```sql
-- الطبقة الأولى: الصلاحيات. دور التطبيق لا يملك DELETE ولا UPDATE
-- إلا على عمود superseded_by وحده.
REVOKE UPDATE, DELETE ON attestations FROM nx_app;
GRANT UPDATE (superseded_by) ON attestations TO nx_app;
GRANT DELETE ON attestations TO nx_retention;

-- الطبقة الثانية: محفزان يرفعان أخطاء بأكوادنا.
CREATE FUNCTION app.attestations_forbid_update() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'attestation % is already superseded' USING ERRCODE = 'NX001';
  END IF;
  IF NEW.superseded_by IS NULL THEN
    RAISE EXCEPTION 'superseded_by cannot be cleared' USING ERRCODE = 'NX001';
  END IF;
  IF (to_jsonb(NEW) - 'superseded_by') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_by') THEN
    RAISE EXCEPTION 'superseded_by is the only mutable column' USING ERRCODE = 'NX001';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_attestations_forbid_update
  BEFORE UPDATE ON attestations
  FOR EACH ROW EXECUTE FUNCTION app.attestations_forbid_update();

CREATE FUNCTION app.attestations_forbid_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF pg_has_role(current_user, 'nx_retention', 'USAGE') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'attestations may only be deleted by the retention role'
    USING ERRCODE = 'NX002';
END; $$;

CREATE TRIGGER trg_attestations_forbid_delete
  BEFORE DELETE ON attestations
  FOR EACH ROW EXECUTE FUNCTION app.attestations_forbid_delete();
```

التحديث الوحيد المسموح هو ضبط `superseded_by` مرة واحدة. الحذف حصراً عبر دور الاحتفاظ.

> **تصحيح (ADR-010).** كان هذا القسم يقترح `CREATE RULE ... DO INSTEAD NOTHING`. تلك القاعدة تفشل الحارس 01 من وجهين: تسمح بأي `UPDATE` على صف لم يُوسم بعد بما فيه إعادة كتابة `value` أو `observed_at`، وتبتلع المخالفة صامتة بدل رفع خطأ. والمحفزات ترفض المالك نفسه، وهو ما يثبته الحارس بتشغيل نفس المحاولات بدور المالك الذي يملك الصلاحية أصلاً.

---

## 4. العلاقات

```sql
CREATE TABLE entity_relations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  from_entity  uuid NOT NULL REFERENCES entities(id),
  to_entity    uuid NOT NULL REFERENCES entities(id),
  rel_type     text NOT NULL,
    -- MANAGES | OWNS | HOLDS_ACCOUNT | OWNS_PROPERTY | SHARES_ADDRESS
  attributes   jsonb,
  attestation_id uuid NOT NULL REFERENCES attestations(id),
  valid_from   timestamptz NOT NULL,
  valid_until  timestamptz,
  ended_at     timestamptz
);

CREATE INDEX ix_rel_to ON entity_relations (tenant_id, to_entity, rel_type)
  WHERE ended_at IS NULL;
```

**العلاقات أيضاً لا تُحذف، بل تُنهى بـ`ended_at`.** حين يتغير المدير المفوّض، تُنهى العلاقة القديمة وتُنشأ جديدة، ويبقى التاريخ.

### استعلام شبكة العلاقات

الكشف الذي يبيع المنتج:

```sql
SELECT p.id AS person, count(DISTINCT r.from_entity) AS linked_businesses
FROM entity_relations r
JOIN entities p ON p.id = r.to_entity
WHERE r.tenant_id = $1
  AND r.rel_type = 'MANAGES'
  AND r.ended_at IS NULL
GROUP BY p.id
HAVING count(DISTINCT r.from_entity) >= 3;
```

نفس النمط لاكتشاف آيبان مشترك بين كيانات، أو عنوان وطني مشترك.

---

## 5. الإسقاط: الملف الشخصي

الملف ليس جدولاً بل عرضاً محسوباً:

```sql
-- security_invoker إلزامي. العرض بلا هذا الخيار يعمل بصلاحيات مالكه،
-- والمالك يملك كل الجداول، فيقرأ متجاوزاً كل سياسات RLS.
CREATE VIEW entity_profile WITH (security_invoker = true) AS
SELECT DISTINCT ON (a.tenant_id, a.entity_id, a.field_path)
  a.tenant_id, a.entity_id, a.field_path, a.value,
  a.authority, a.observed_at, a.confidence, a.id AS attestation_id,
  policy.ttl_days, policy.weight,
  COALESCE(a.valid_until, a.observed_at + make_interval(days => policy.ttl_days))
    AS effective_until,
  app.freshness_state(
    COALESCE(a.valid_until, a.observed_at + make_interval(days => policy.ttl_days)),
    policy.ttl_days
  ) AS freshness
FROM attestations a
LEFT JOIN LATERAL (
  SELECT p.ttl_days, p.weight
  FROM freshness_policy p
  WHERE (a.field_path = p.field_path OR a.field_path LIKE p.field_path || '.%')
    AND (
      (p.portfolio_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM portfolio_members m
         WHERE m.tenant_id = a.tenant_id AND m.entity_id = a.entity_id
           AND m.portfolio_id = p.portfolio_id))
      OR (p.portfolio_id IS NULL AND (p.tenant_id = a.tenant_id OR p.tenant_id IS NULL))
    )
  ORDER BY (p.portfolio_id IS NOT NULL) DESC, p.tenant_id NULLS LAST,
           length(p.field_path) DESC, p.ttl_days ASC
  LIMIT 1
) policy ON true
WHERE a.superseded_by IS NULL
ORDER BY a.tenant_id, a.entity_id, a.field_path, a.observed_at DESC;
```

وحالات الحداثة الأربع تُعرَّف مرة واحدة في دالة يستعملها العرض ومعاينة الأثر معاً:

```sql
CREATE FUNCTION app.freshness_state(effective_until timestamptz, ttl_days int DEFAULT NULL)
  RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN effective_until IS NULL THEN 'permanent'
    WHEN effective_until <= now() THEN 'expired'
    WHEN effective_until <= now() + CASE
           WHEN ttl_days IS NULL THEN interval '14 days'
           ELSE least(interval '14 days', make_interval(days => ttl_days) * 0.25)
         END THEN 'expiring'
    ELSE 'fresh'
  END;
$$;
```

للأداء عند الحجم الكبير، حوّله إلى `MATERIALIZED VIEW` مع تحديث تدريجي عند كتابة كل إفادة، أو جدول إسقاط مُصان بـtrigger. **ابدأ بالعرض العادي**، ولا تُحسّن قبل أن تقيس.

> **تصحيحان.**
>
> **الأول (ADR-013).** كان العرض يحسب الحداثة من `valid_until` المخزّن. ذلك يجمّد عمر الحقل على المدة التي كانت سارية يوم كُتب، ويجعل تعديل المدة يستلزم إعادة كتابة إفادات، وهو ما تمنعه القاعدة 1. الحساب الآن من `observed_at` والمدة السارية لحظة القراءة، و`valid_until` يبقى لانتهاء فعلي صادر عن الجهة وهو يتغلب لأن انتهاءً حقيقياً أولى من تقدير.
>
> **الثاني (ADR-012).** كانت نافذة "مقترب من الانتهاء" أربعة عشر يوماً ثابتة. بعد التحول إلى الحساب انكسر هذا الثابت: `cr.status` مدته سبعة أيام، فنافذة أربعة عشر تجعله مقترب الانتهاء لحظة التحقق منه، وتحذير يعمل دائماً ليس تحذيراً. النافذة الآن الأقل بين أربعة عشر يوماً وربع المدة، والحقل بلا مدة يبقى على الثابت لأنه لا مدة لتؤخذ منها نسبة.

---

## 6. سياسة الحداثة

```sql
CREATE TABLE freshness_policy (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid,
  portfolio_id uuid,
  field_path   text NOT NULL,
  ttl_days     int  NOT NULL CHECK (ttl_days > 0),
  weight       int  NOT NULL DEFAULT 10 CHECK (weight >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- صف واحد لكل حقل لكل مستوى.
CREATE UNIQUE INDEX uq_freshness_policy
  ON freshness_policy (
    (COALESCE(tenant_id,   '00000000-0000-0000-0000-000000000000'::uuid)),
    (COALESCE(portfolio_id,'00000000-0000-0000-0000-000000000000'::uuid)),
    field_path
  );
```

`tenant_id = NULL` يعني السياسة الافتراضية، ويمكن لكل عميل تجاوزها، ولكل محفظة تجاوزها فوقه.

**ترتيب الأخصية:** المحفظة، ثم المشترك، ثم افتراضي النظام. وبين المحافظ المتعارضة تفوز المدة الأقصر (ADR-035): إن قالت أي محفظة إن هذا الحقل يجب فحصه أسبوعياً فهو كذلك، والحسم في الاتجاه المتساهل يُضعف صامتاً سياسة أشد وضعها أحدهم عمداً.

**والمطابقة بأطول بادئة** (ADR-029): صف على `cr.core` يحكم `cr.core.name` و`cr.core.capital` بلا صف لكل واحد. بلا ذلك يحتاج كل تخطيط جديد في `step_field_map` صف سياسة مرافقاً، وأول نسيان يُسقط الحقل من الحداثة والدرجة معاً بصمت.

> **تصحيح.** كان المفتاح مكتوباً `PRIMARY KEY (COALESCE(tenant_id, ...), field_path)`. بوستجرس لا يقبل تعبيراً في مفتاح أساسي. الفهرس الفريد على نفس التعبير يعطي الضمان ذاته.

### القيم الافتراضية المقترحة

| `field_path` | TTL | الوزن | المنطق |
|---|---|---|---|
| `cr.status` | 7 | 20 | يتغير بلا إشعار، وهو الأخطر |
| `cr.core` | 90 | 26 | البيانات الأساسية بطيئة التغير |
| `address.national` | 30 | 14 | يتغير بانتقال المقر |
| `manager.signing_authority` | 90 | 24 | حرج قانونياً |
| `freelance.document` | من تاريخ الانتهاء | 12 | له انتهاء فعلي، لا TTL تقديري |
| `iban.ownership` | 180 | 14 | مستقر نسبياً |
| `property.deed` | 365 | 10 | شديد الاستقرار |

**درجة الثقة** تُحسب بنفس أوزان الجدول: طازج يأخذ الوزن كاملاً، مقترب من الانتهاء يأخذ 55%، منتهٍ يأخذ صفراً. وتُخزَّن مع تفصيلها لا كرقم مجرد:

```sql
CREATE TABLE entity_scores (
  tenant_id  uuid, entity_id uuid,
  score      int NOT NULL,
  breakdown  jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity_id)
);
```

`breakdown` إلزامي. درجة بلا تفسير مرفوضة في القطاع المالي.

---

## 7. المراقبة والتنبيهات

```sql
CREATE TABLE monitors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  entity_id    uuid NOT NULL REFERENCES entities(id),
  field_paths  text[] NOT NULL,
  cadence      text NOT NULL,      -- DAILY | WEEKLY | MONTHLY | ON_EXPIRY
  next_run_at  timestamptz NOT NULL,
  budget_cap_sar numeric(10,2),
  status       text NOT NULL DEFAULT 'active'
);

CREATE INDEX ix_mon_due ON monitors (next_run_at)
  WHERE status = 'active';

CREATE TABLE change_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  entity_id     uuid NOT NULL,
  field_path    text NOT NULL,
  old_attestation uuid REFERENCES attestations(id),
  new_attestation uuid NOT NULL REFERENCES attestations(id),
  severity      text NOT NULL,     -- INFO | WARNING | CRITICAL
  detected_at   timestamptz NOT NULL DEFAULT now(),
  notified_at   timestamptz,
  acknowledged_by uuid
);
```

### منطق كشف التغيّر

عند كتابة كل إفادة جديدة:

```
1. اجلب الإفادة السارية الحالية لنفس (entity_id, field_path)
2. إن لم توجد → أدرج الجديدة، لا حدث تغيّر
3. إن وُجدت وكان value_hash متطابقاً
   → أدرج الجديدة (تجديد حداثة)، اضبط superseded_by على القديمة، لا حدث
4. إن اختلف value_hash
   → أدرج الجديدة، اضبط superseded_by
   → أنشئ change_event بالخطورة من جدول القواعد
   → أطلق webhook
```

**الخطوة 3 مهمة:** إعادة التحقق بلا تغيير **تُدرج إفادة جديدة** ولا تُحدّث القديمة. هذا ما يحفظ الإجابة على سؤال "متى تأكدت آخر مرة؟" منفصلة عن "متى تغيّر آخر مرة؟".

### خطورة التغيّر

| التغيّر | الخطورة |
|---|---|
| `cr.status` من نشط إلى موقوف أو ملغى | CRITICAL |
| تغيّر المدير المفوّض بالتوقيع | CRITICAL |
| انتهاء وثيقة العمل الحر | CRITICAL |
| تغيّر ملكية الآيبان | CRITICAL |
| تغيّر العنوان الوطني | WARNING |
| تغيّر رأس المال أو الأنشطة | WARNING |
| تجديد بلا تغيير | لا حدث |

**`budget_cap_sar` غير قابل للتفاوض.** المراقبة تصرف من رصيد العميل تلقائياً، وسقف شهري لكل مراقب يمنع فاتورة مفاجئة تُنهي العلاقة.

---

## 8. عمليات التحقق والأدلة

```sql
CREATE TABLE verification_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  product_code   text NOT NULL,
  entity_id      uuid,
  client_ref     text,
  idempotency_key text,
  mode_at_execution text NOT NULL,
  provider_used  text,
  status         text NOT NULL,   -- PENDING | OK | PARTIAL | NOT_FOUND | ERROR
  decision       text,            -- PASS | FAIL | REVIEW
  decision_reasons jsonb,
  latency_ms     int,
  billable       boolean NOT NULL DEFAULT true,
  billed_amount  numeric(10,2),
  provider_cost  numeric(10,2),
  triggered_by   text NOT NULL,   -- API | CONSOLE | MONITOR | BULK
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_idem
  ON verification_runs (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE run_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  run_id        uuid NOT NULL REFERENCES verification_runs(id),
  step_key      text NOT NULL,
  provider      text NOT NULL,
  endpoint      text NOT NULL,
  status        text NOT NULL,   -- OK | NOT_FOUND | ERROR | SKIPPED | CACHED
  served_from_cache boolean NOT NULL DEFAULT false,
  latency_ms    int,
  billable      boolean NOT NULL DEFAULT true,
  billed_amount numeric(10,2),
  provider_cost numeric(10,2),
  error_code    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_step_run ON run_steps (tenant_id, run_id);
```

> المنتج المركّب ينتج عملية واحدة وعدة خطوات. التكلفة والفوترة والحالة تُحسب على مستوى الخطوة ثم تُجمَّع للعملية. تفاصيل تعريف المنتجات وتنفيذ الخطوات في ملحق `nx-verify-products.md`.

```sql
CREATE TABLE evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  run_id       uuid NOT NULL REFERENCES verification_runs(id),
  storage_key  text NOT NULL,
  content_hash bytea NOT NULL,
  signed_at    timestamptz NOT NULL,
  signature    bytea NOT NULL,
  public_token text UNIQUE,
  expires_at   timestamptz
);
```

**`mode_at_execution` و`provider_cost` يُثبَّتان لحظة التنفيذ.** ترقية عميل من BYOC إلى MANAGED في منتصف الشهر لا يجوز أن تُغيّر فوترة ما مضى.

**`public_token`** يخدم رمز QR على ملف الدليل: صفحة عامة تعرض هاش المستند وتاريخ الختم فقط، بلا أي بيانات شخصية.

---

## 9. التسعير والرصيد

```sql
CREATE TABLE cost_book (
  provider   text NOT NULL,
  endpoint   text NOT NULL,
  unit_cost  numeric(10,2) NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to   timestamptz,
  PRIMARY KEY (provider, endpoint, valid_from)
);

CREATE TABLE product_map (
  product_code      text NOT NULL,
  provider          text NOT NULL,
  endpoint          text NOT NULL,
  sequence          int  NOT NULL,
  required          boolean NOT NULL DEFAULT true,
  fallback_provider text,
  PRIMARY KEY (product_code, provider, endpoint)
);

CREATE TABLE price_book (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid,
  product_code text NOT NULL,
  unit_price   numeric(10,2) NOT NULL,
  tier_min     int NOT NULL DEFAULT 0,
  tier_max     int,
  negative_pct numeric(4,2) NOT NULL DEFAULT 0.50,
  valid_from   timestamptz NOT NULL,
  valid_to     timestamptz,
  version      int NOT NULL,
  contract_id  uuid
);

CREATE TABLE wallets (
  tenant_id       uuid PRIMARY KEY REFERENCES tenants(id),
  balance         numeric(12,2) NOT NULL DEFAULT 0,
  -- المحجوز لعمليات بدأت ولم تُسوَّ بعد.
  held            numeric(12,2) NOT NULL DEFAULT 0 CHECK (held >= 0),
  currency        char(3) NOT NULL DEFAULT 'SAR',
  expires_at      timestamptz,
  low_threshold   numeric(12,2) NOT NULL DEFAULT 0.15
);

CREATE TABLE wallet_ledger (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  delta       numeric(12,2) NOT NULL,
  balance_after numeric(12,2) NOT NULL,
  reason      text NOT NULL,
    -- TOPUP | CHARGE | REFUND | EXPIRY | ADJUSTMENT | HOLD | RELEASE
  run_id      uuid REFERENCES verification_runs(id),
  vat_invoice_id text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- الضريبة تستحق عند الشحن. لا فاتورة ضريبية ثانية عند الاستهلاك.
  CONSTRAINT ck_vat_only_on_topup CHECK (vat_invoice_id IS NULL OR reason = 'TOPUP')
);
```

والدفتر append-only بمحفز يرفع `NX004` على أي `UPDATE` أو `DELETE`، تماماً كجدول الإفادات وللسبب نفسه: رصيد قابل للتعديل رصيد لا يستطيع أحد الدفاع عنه في خلاف فوترة.

> **تصحيح (ADR-019).** أُضيف سببان إلى القائمة: `HOLD` و`RELEASE`، وعمود `held` إلى `wallets`. القاعدة 3 في القسم 6 من ملحق المنتجات توجب حجز أعلى تكلفة قبل التنفيذ ثم تسوية الفرق، وهذا لا يُعبَّر عنه بـ`CHARGE` وحده: البديلان هما إمساك قفل على صف المحفظة عبر استدعاءات الشبكة، أو السماح برصيد سالب عند التوازي، وكلاهما مرفوض. المسار: حجز الحد الأقصى، تنفيذ، ثم `RELEASE` للحجز و`CHARGE` بالمبلغ الفعلي في معاملة واحدة.

### قواعد التسعير

**١. حارس الهامش.** فحص عند حفظ أي سعر:

```sql
ALTER TABLE price_book ADD CONSTRAINT ck_margin CHECK (unit_price > 0);
```

والفحص الحقيقي في طبقة التطبيق: `unit_price >= SUM(unit_cost) * (1 + min_margin)`. عند رفع مزوّد لسعره، شغّل مسحاً على كل العقود السارية وأصدر تنبيهاً لكل عقد نزل هامشه تحت الحد.

**٢. لا تعديل، بل نسخة.** تغيير سعر = `UPDATE price_book SET valid_to = now() WHERE id = ...` ثم `INSERT` بنسخة جديدة. كل عملية تُسعَّر بالسطر الساري لحظة `created_at`.

**٣. أولوية السعر:** عقد → مستأجر → شريحة → افتراضي.

**٤. الاستعلام السلبي** يُفوتر بـ`negative_pct` من السعر، والخطأ التقني لا يُفوتر إطلاقاً (`billable = false`).

**٥. دفتر الرصيد append-only.** لا يُحدَّث صف قط. الرصيد الحالي = آخر `balance_after`، ويُطابَق دورياً مع `wallets.balance`.

**٦. الضريبة تستحق عند الشحن لا عند الاستهلاك.** صف `TOPUP` يحمل `vat_invoice_id`، وصفوف `CHARGE` لا تحمله. لا تصدر فاتورة ضريبية ثانية عند الاستهلاك.

---

## 10. التدقيق والاحتفاظ

```sql
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  tenant_id  uuid NOT NULL,
  actor_type text NOT NULL,   -- USER | API_KEY | SYSTEM
  actor_id   text NOT NULL,
  action     text NOT NULL,
  target     text,
  ip         inet,
  request_id text,
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);
```

**قراءة الاعتمادات تُسجَّل هنا أيضاً**، لا الكتابة فقط.

### مهمة الاحتفاظ اليومية

```
لكل مستأجر:
  أتلف إتلافاً تاماً كل إفادة مُوسَمة superseded_by
    وobserved_at أقدم من retention_days
  ولكل كيان لا تحمل أي إفادة له تاريخاً داخل المدة:
     احذف معرّفاته من entity_identifiers
     وسِمه بـarchived_at
  سجّل عملية الإتلاف في audit_log
```

الحذف يجري بدور `nx_retention` وحده، وهو الدور الوحيد في النظام الحامل لـ`DELETE` على `attestations`.

> **تصحيح (ADR-028).** كان النص يقول: أبقِ القيمة وأخفِ التفاصيل الشخصية على الإفادة السارية. ذلك يستلزم تعديل صف في `attestations`، وهو ممنوع بالقاعدة 1 ويرفضه الحارس 01 ويرفضه المحفز في القسم 3.
>
> الإتلاف يطال إذن المكان الذي تعيش فيه البيانات الشخصية فعلاً: المعرّفات. قيم الإفادات تبقى لأنها لا تحمل معرّفاً صريحاً أصلاً (القاعدة 4)، فيبقى سجل ما تم التحقق منه وتزول القدرة على ربطه بشخص. وهذا يحفظ الوعدين معاً: "بياناتكم تُتلف تلقائياً"، و"سجل التدقيق يبقى قابلاً للتقديم".

سياسة الاحتفاظ **ميزة بيعية لا عبء**. "بياناتكم تُتلف تلقائياً بعد المدة المتعاقد عليها" جملة يحبها مسؤول الامتثال.

### عزل المستأجر

```sql
ALTER TABLE attestations ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON attestations
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

طبّقها على كل جدول يحمل `tenant_id`. الاعتماد على شرط `WHERE` في الكود وحده خطأ سيقع يوماً ما.

---

## 11. ترتيب البناء

| # | الخطوة | لماذا هذا الترتيب |
|---|--------|-------------------|
| 1 | tenants, entities, entity_identifiers, attestations | الأساس، ولا شيء يعمل قبله |
| 2 | verification_runs + الـRouter + التطبيع | تُنتج الإفادات |
| 3 | entity_profile + freshness_policy | يظهر الملف على الشاشة |
| 4 | price_book, cost_book, wallets, wallet_ledger | لا تُطلق بلا فوترة صحيحة |
| 5 | evidence | أقوى مخرَج بيعي |
| 6 | monitors + change_events | الميزة التي تُباع بها المنصة |
| 7 | entity_relations + استعلام الشبكة | مفاجأة العرض التوضيحي |
| 8 | entity_scores | يحتاج بيانات متراكمة أولاً |

---

## 12. خمسة أخطاء شائعة، وقعت فيها فرق كثيرة

1. **تحديث الحقل في مكانه.** يفقدك التاريخ، ولا يُسترجع لاحقاً بأي ثمن. هذا الخطأ لا رجعة فيه.
2. **إهمال `idempotency_key`.** انقطاع شبكة واحد يعني استعلامين ورسمين، وشكوى فوترة في الأسبوع الأول.
3. **بناء جدول منفصل لكل نوع تحقق.** المنتج العاشر يعني الجدول العاشر والشاشة العاشرة. استعمل `entity_type` و`field_path`.
4. **تخزين رقم الهوية نصاً صريحاً.** مخالفة صريحة، وتُكتشف في أول مراجعة أمنية لدى عميل مالي.
5. **درجة ثقة بلا `breakdown`.** ترفضها إدارة المخاطر فوراً، ويسقط معها أثرها البيعي كله.

---

## 13. تحذير قانوني

كل ما في هذا المخطط يقوم على **تخزين نتائج التحقق وبناء ملفات مشتقة منها**. هذا لا يجوز تشغيله قبل نص صريح في عقدك مع المزود يمنحك:

> الحق في تخزين نتائج التحقق والاحتفاظ بها كسجل تدقيق، وبناء ملفات كيانات مشتقة منها لصالح العميل النهائي الذي طلب التحقق، للمدة المتفق عليها.

وبيانات المدراء والملاك والآيبانات والعقارات بيانات شخصية. NX معالج والعميل متحكم، وتلزم اتفاقية معالجة بيانات وسياسة احتفاظ وإتلاف وآلية لتنفيذ حقوق أصحاب البيانات.
