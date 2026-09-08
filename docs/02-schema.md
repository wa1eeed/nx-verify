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

```sql
CREATE RULE att_no_update AS ON UPDATE TO attestations
  WHERE OLD.superseded_by IS NOT NULL DO INSTEAD NOTHING;

REVOKE DELETE ON attestations FROM app_role;
```

التحديث الوحيد المسموح هو ضبط `superseded_by` مرة واحدة. الحذف حصراً عبر دور الاحتفاظ.

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
CREATE VIEW entity_profile AS
SELECT DISTINCT ON (a.tenant_id, a.entity_id, a.field_path)
  a.tenant_id, a.entity_id, a.field_path, a.value,
  a.authority, a.observed_at, a.valid_until, a.confidence,
  CASE
    WHEN a.valid_until IS NULL THEN 'permanent'
    WHEN a.valid_until <= now() THEN 'expired'
    WHEN a.valid_until <= now() + interval '14 days' THEN 'expiring'
    ELSE 'fresh'
  END AS freshness
FROM attestations a
WHERE a.superseded_by IS NULL
ORDER BY a.tenant_id, a.entity_id, a.field_path, a.observed_at DESC;
```

للأداء عند الحجم الكبير، حوّله إلى `MATERIALIZED VIEW` مع تحديث تدريجي عند كتابة كل إفادة، أو جدول إسقاط مُصان بـtrigger. **ابدأ بالعرض العادي**، ولا تُحسّن قبل أن تقيس.

---

## 6. سياسة الحداثة

```sql
CREATE TABLE freshness_policy (
  tenant_id   uuid,
  field_path  text NOT NULL,
  ttl_days    int  NOT NULL,
  weight      int  NOT NULL DEFAULT 10,
  PRIMARY KEY (COALESCE(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid), field_path)
);
```

`tenant_id = NULL` يعني السياسة الافتراضية، ويمكن لكل عميل تجاوزها.

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
  currency        char(3) NOT NULL DEFAULT 'SAR',
  expires_at      timestamptz,
  low_threshold   numeric(12,2) NOT NULL DEFAULT 0.15
);

CREATE TABLE wallet_ledger (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  delta       numeric(12,2) NOT NULL,
  balance_after numeric(12,2) NOT NULL,
  reason      text NOT NULL,   -- TOPUP | CHARGE | REFUND | EXPIRY | ADJUSTMENT
  run_id      uuid REFERENCES verification_runs(id),
  vat_invoice_id text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

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
  حدد الإفادات حيث observed_at < now() - retention_days
  إن لم تكن الإفادة الأخيرة السارية لحقلها:
     أتلفها إتلافاً تاماً
  وإلا:
     أبقِ القيمة، أخفِ التفاصيل الشخصية (tombstone)
  سجّل عملية الإتلاف في audit_log
```

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
