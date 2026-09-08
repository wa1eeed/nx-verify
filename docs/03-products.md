# NX Verify — كتالوج المنتجات وتنسيق الخطوات

**ملحق لمخطط قاعدة البيانات · الإصدار 1.0**

يحل هذا الملحق محل جدول `product_map` المبسّط الوارد في القسم 9 من المخطط الأساسي.

---

## 0. القاعدة الحاكمة

> **شكل الطلب يتغيّر حسب المنتج. شكل الاستجابة لا يتغيّر أبداً.**

المظروف واحد لكل المنتجات، والمتغير الوحيد هو محتوى `subject`، ويُتحقق منه مقابل مخطط JSON Schema مخزّن في تعريف المنتج نفسه.

النتيجة العملية لهذي القاعدة: **إضافة منتج تحقق جديد تصير صفوفاً في قاعدة البيانات، لا إصداراً برمجياً جديداً.**

---

## 1. تعريف المنتج

```sql
CREATE TABLE products (
  code            text PRIMARY KEY,
  name_ar         text NOT NULL,
  name_en         text NOT NULL,
  subject_type    text NOT NULL,
    -- BUSINESS | PERSON | FREELANCER | BANK_ACCOUNT | PROPERTY
  input_schema    jsonb NOT NULL,
  is_composite    boolean NOT NULL DEFAULT false,
  partial_policy  text NOT NULL DEFAULT 'BEST_EFFORT',
    -- ALL_OR_NOTHING | BEST_EFFORT
  decision_ruleset uuid,
  status          text NOT NULL DEFAULT 'active',
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz
);
```

| الحقل | الدور |
|-------|-------|
| `subject_type` | نوع الكيان الرئيسي الذي يتعلق به المنتج |
| `input_schema` | JSON Schema يُتحقق منه قبل أي استدعاء لمزود. يمنع صرف رصيد على طلب ناقص |
| `partial_policy` | `ALL_OR_NOTHING` يُلغي العملية كلها عند فشل خطوة إلزامية، و`BEST_EFFORT` يُرجع ما نجح |
| `decision_ruleset` | مجموعة القواعد التي تُنتج `PASS / FAIL / REVIEW` لهذا المنتج تحديداً |

---

## 2. الخطوات والتبعيات

```sql
CREATE TABLE product_steps (
  product_code     text NOT NULL REFERENCES products(code),
  step_key         text NOT NULL,
  seq              int  NOT NULL,
  provider         text NOT NULL,
  endpoint         text NOT NULL,
  input_binding    jsonb NOT NULL,
  depends_on       text[] NOT NULL DEFAULT '{}',
  required         boolean NOT NULL DEFAULT true,
  fallback_provider text,
  cache_ttl_days   int,
  PRIMARY KEY (product_code, step_key)
);
```

**`input_binding`** يصف كيف يُبنى طلب المزود من `subject` ومن مخرجات خطوات سابقة:

```json
{
  "unified_number": "$.subject.unn",
  "manager_id":     "$.subject.manager.id",
  "type":           "literal:MANAGER_PERMISSIONS"
}
```

المراجع المسموحة ثلاثة فقط: `$.subject.*` من مدخلات العميل، و`$.steps.<step_key>.<path>` من مخرجات خطوة سابقة، و`literal:` لقيمة ثابتة.

**`depends_on`** يبني رسماً بيانياً موجّهاً غير دوري (DAG). الخطوات المستقلة تُنفَّذ بالتوازي، والتابعة تنتظر.

**`cache_ttl_days`** على مستوى الخطوة لا المنتج. هذي نقطة مهمة: في `KYB_COMPLETE`، خطوة العنوان الوطني قد تُخدَم من الكاش بينما خطوة حالة السجل تُستدعى حية دائماً.

---

## 3. تخطيط المخرجات إلى الإفادات والكيانات

```sql
CREATE TABLE step_field_map (
  product_code           text NOT NULL,
  step_key               text NOT NULL,
  -- مسار في حمولة المزوّد. يقبل [*] واحدة للمرور على مصفوفة،
  -- وعندها @.<path> يقرأ حقلاً من العنصر الحالي.
  source_path            text NOT NULL,
  field_path             text NOT NULL,
  entity_role            text NOT NULL DEFAULT 'SUBJECT',
    -- SUBJECT | MANAGER | OWNER | ACCOUNT_HOLDER | PROPERTY_OWNER
  entity_type            text,
  identifier_path        text,
  -- نوع المعرّف: literal:<TYPE> أو مسار. إلزامي لكل كيان فرعي.
  identifier_type_source text,
  relation_type          text,
  -- انتهاء فعلي مطبوع في الحمولة، مثل تاريخ انتهاء وثيقة العمل الحر.
  valid_until_path       text,
  confidence             numeric(4,3) NOT NULL DEFAULT 1.000,
  PRIMARY KEY (product_code, step_key, source_path),
  -- كيان فرعي بلا معرّف لا يمكن حلّه، وإنشاؤه بلا حل هو ما يُدخل التكرار.
  CONSTRAINT ck_secondary_entity_is_resolvable CHECK (
    entity_role = 'SUBJECT' OR (identifier_path IS NOT NULL AND entity_type IS NOT NULL)
  )
);
```

هذا الجدول هو ما يحوّل استجابة المزود إلى إفادات وكيانات وعلاقات، **بلا سطر كود لكل منتج**.

> **ثلاثة تصحيحات.**
>
> **حُذف `ttl_override` (ADR-017).** كتابة مدة لكل تخطيط على الإفادة تجمّد عمر الحقل على ما قاله تعريف المنتج يوم كُتبت، وهو بالضبط ما أزاله ADR-013، ويعيد تعديل المدة إلى كتابة على `attestations`. مدة الحقل تعيش في `freshness_policy` وحدها، وهي أصلاً ثلاثية المستويات وأثرها فوري.
>
> **أُضيف `identifier_type_source` (ADR-018).** `identifier_path` وحده يعطي سلسلة أرقام، وسجل تجاري وهوية وطنية قد يتشابهان طولاً وشكلاً. التخمين هنا يدمج شخصين مختلفين في كيان واحد، وهو خطأ لا يظهر إلا متأخراً ولا يُفكّ بسهولة. النوع يُصرَّح به، والتطبيع يرفع خطأ إن لم يُحسم.
>
> **أُضيف `valid_until_path` و`confidence`.** الأول لانتهاء فعلي صادر عن الجهة، وهو ما كان `ttl_override` يحاول تغطيته بالطريقة الخاطئة. والثاني لأن مطابقة بالاسم ليست دليلاً بقوة مطابقة بمعرّف.

- `entity_role = SUBJECT` يعني أن الإفادة تُلحق بالكيان الرئيسي.
- أي دور آخر يعني إنشاء أو مطابقة كيان فرعي، وربطه بعلاقة من نوع `relation_type`.
- `identifier_path` يحدد المعرّف الذي يُحل به الكيان الفرعي، وهو ما يمنع تكرار نفس الشخص عشر مرات.
- اتجاه العلاقة ثابت: من الكيان الرئيسي إلى الكيان الفرعي. فـ`MANAGES` تعني `from_entity` المنشأة و`to_entity` الشخص، وهو ما يجعل استعلام الشبكة في المخطط يعدّ المنشآت لكل شخص.

**المرور على مصفوفة.** عقد التأسيس يُرجع عدة مدراء، وصف تخطيط واحد يغطيهم:

```
source_path            = $.managers[*].signing_authority
field_path             = manager.signing_authority
entity_role            = MANAGER
entity_type            = PERSON
identifier_path        = @.id
identifier_type_source = @.id_type
relation_type          = MANAGES
```

كل عنصر يُنتج كياناً وإفادة وعلاقة. ونفس الشخص في ثلاث منشآت يُحل إلى كيان واحد بثلاث علاقات، وهو ما يجعل استعلام الشبكة يجده بلا تخزين إضافي.

---

## 4. ثلاثة أمثلة كاملة

### 4.1 منتج بسيط بخطوة واحدة: العنوان الوطني

```json
{
  "code": "ADDRESS_ONLY",
  "name_ar": "التحقق من العنوان الوطني",
  "subject_type": "BUSINESS",
  "is_composite": false,
  "input_schema": {
    "type": "object",
    "required": ["unn"],
    "properties": {
      "unn": { "type": "string", "pattern": "^7[0-9]{9}$" }
    }
  }
}
```

```json
{
  "step_key": "address",
  "seq": 1,
  "endpoint": "business_verification",
  "input_binding": {
    "identifications": "$.subject.unn",
    "type": "literal:ADDRESS"
  },
  "required": true,
  "cache_ttl_days": 30
}
```

التخطيط: `$.address.city` و`$.address.district` و`$.address.building_number` جميعها إلى `field_path = address.national` بدور `SUBJECT`.

### 4.2 منتج ينشئ كياناً فرعياً: ملكية الآيبان

```json
{
  "code": "IBAN_OWNERSHIP",
  "name_ar": "التحقق من ملكية الآيبان",
  "subject_type": "BANK_ACCOUNT",
  "is_composite": false,
  "input_schema": {
    "type": "object",
    "required": ["iban", "identifier"],
    "properties": {
      "iban": { "type": "string", "pattern": "^SA[0-9]{22}$" },
      "identifier": {
        "type": "object",
        "required": ["type", "value"],
        "properties": {
          "type": { "enum": ["NATIONAL_ID", "IQAMA", "CR"] },
          "value": { "type": "string" }
        }
      },
      "name": { "type": "string" }
    }
  }
}
```

التخطيط هنا يُنشئ **كيانين وعلاقة**:

| `source_path` | `field_path` | `entity_role` | `relation_type` |
|---|---|---|---|
| `$.match_result` | `iban.ownership` | `SUBJECT` | — |
| `$.account_holder.name` | `holder.name` | `ACCOUNT_HOLDER` | `HOLDS_ACCOUNT` |

فيصبح الآيبان كياناً مستقلاً، مرتبطاً بالشخص أو المنشأة، ويظهر تلقائياً في قائمة الآيبانات وفي شبكة العلاقات.

### 4.3 منتج مركّب بتبعية: التحقق الشامل

```json
{
  "code": "KYB_COMPLETE",
  "name_ar": "التحقق الشامل للمنشأة",
  "subject_type": "BUSINESS",
  "is_composite": true,
  "partial_policy": "BEST_EFFORT",
  "input_schema": {
    "type": "object",
    "oneOf": [
      { "required": ["unn"] },
      { "required": ["cr_number"] }
    ],
    "properties": {
      "unn": { "type": "string" },
      "cr_number": { "type": "string" },
      "manager": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "id_type": { "enum": ["NATIONAL_ID", "IQAMA"] }
        }
      }
    }
  }
}
```

الخطوات:

| `step_key` | `seq` | `depends_on` | `required` | `cache_ttl_days` |
|---|---|---|---|---|
| `cr_full` | 1 | — | نعم | 0 (حي دائماً) |
| `address` | 2 | `cr_full` | لا | 30 |
| `aoa` | 3 | `cr_full` | لا | 90 |
| `manager_auth` | 4 | `aoa` | لا | 90 |
| `ubo` | 5 | `cr_full` | لا | 90 |

**لاحظ `oneOf` في المخطط:** العميل يرسل الرقم الوطني الموحد أو رقم السجل التجاري، لا الاثنين. وخطوة `cr_full` تستخرج الرقم الموحد وتمرره للخطوات التالية عبر `$.steps.cr_full.unified_number`.

**ولاحظ أن أربع خطوات من خمس غير إلزامية.** منشأة فردية بلا عقد تأسيس تُرجع نتيجة صحيحة بحالة `PARTIAL` بدل فشل كامل. هذا فرق ضخم في تجربة العميل.

---

## 5. تنفيذ الرسم البياني

```
1. تحقق من subject مقابل input_schema
   فشل → 422، بلا أي استدعاء، بلا أي رسم مالي
2. رتّب الخطوات طوبولوجياً حسب depends_on
3. لكل موجة من الخطوات المستقلة، نفّذها بالتوازي:
   أ. ابنِ طلب المزود من input_binding
   ب. افحص الكاش إن كان cache_ttl_days > 0
      إصابة → run_steps.status = CACHED, provider_cost = 0
   ج. استدعِ المزود، وعند الفشل جرّب fallback_provider
   د. سجّل run_steps
   هـ. طبّق step_field_map لتوليد الإفادات والكيانات والعلاقات
4. إن فشلت خطوة required:
   ALL_OR_NOTHING → أنهِ العملية بحالة ERROR
   BEST_EFFORT    → تخطَّ الخطوات التابعة لها بحالة SKIPPED
5. جمّع حالة العملية:
   كل الخطوات OK                    → OK
   بعضها OK والبعض فشل أو تخطّى     → PARTIAL
   كل الخطوات فشلت                  → ERROR
   نجحت الاستدعاءات ولا نتائج       → NOT_FOUND
6. شغّل decision_ruleset على الإفادات الناتجة
7. ولّد ملف الدليل، واحسب درجة الثقة
```

**قاعدة صارمة:** إن فشلت خطوة تُعتمد عليها خطوات أخرى، تُوسم التابعة `SKIPPED` **ولا تُفوتر إطلاقاً**. تحصيل رسم على خطوة لم تُنفَّذ هو أسرع طريق لخلاف فوترة مع عميل مؤسسي.

---

## 6. الفوترة عند النجاح الجزئي

| حالة الخطوة | يُفوتر؟ | المبلغ | تكلفة المزود |
|---|---|---|---|
| `OK` | نعم | سعر الخطوة الكامل | فعلية |
| `NOT_FOUND` | نعم | `negative_pct` من السعر (افتراضياً 50%) | فعلية إن حُسبت |
| `CACHED` | حسب سياسة المنتج | 0 أو 50% | صفر |
| `ERROR` | **لا** | 0 | حسب المزود |
| `SKIPPED` | **لا** | 0 | 0 |

**ثلاث قواعد غير قابلة للتفاوض:**

**١. سعر المنتج المركّب ليس مجموع خطواته.** خزّن `unit_price` للمنتج في `price_book`، وخزّن `step_weight` لتوزيعه على الخطوات عند النجاح الجزئي:

```
billed_amount = product_price × (Σ أوزان الخطوات المفوترة ÷ Σ كل الأوزان)
```

فتحقق شامل نجحت فيه أربع خطوات من خمس يُفوتر بنسبة الأوزان لا بالسعر الكامل، ولا بمجموع أسعار مفردة أعلى من سعر الحزمة.

**٢. الكاش يخفض تكلفتك، ولا يخفض سعرك بالضرورة.** لكن **صرّح بالسياسة في العقد**. أنصح بالفوترة الكاملة على الخطوة المخدومة من الكاش مع إعلان ذلك، أو الإعفاء الكامل كميزة تنافسية. الخيار الوحيد الخطأ هو الغموض.

**٣. الحجز قبل التنفيذ.** احجز أعلى تكلفة ممكنة من رصيد العميل قبل بدء العملية، ثم سوِّ الفرق بعد معرفة النتيجة الفعلية. بدون الحجز، عميل برصيد 40 ريالاً يشغّل تحققاً شاملاً بـ58 ريالاً ويوقعك في رصيد سالب.

---

## 7. القرار لكل منتج

```sql
CREATE TABLE decision_rules (
  ruleset_id  uuid NOT NULL,
  tenant_id   uuid,
  seq         int NOT NULL,
  condition   jsonb NOT NULL,
  outcome     text NOT NULL,   -- PASS | FAIL | REVIEW
  reason_code text NOT NULL,
  reason_ar   text NOT NULL,
  PRIMARY KEY (ruleset_id, seq)
);
```

القواعد تُقيَّم بالترتيب، وأول مطابقة تحسم النتيجة. مثال لمجموعة `KYB_COMPLETE`:

| `seq` | الشرط | النتيجة | السبب |
|---|---|---|---|
| 1 | `cr.status != ACTIVE` | `FAIL` | السجل التجاري غير نشط |
| 2 | `manager.signing_authority.verified = false` | `REVIEW` | تعذّر إثبات صلاحية التوقيع |
| 3 | `address.national` مفقود | `REVIEW` | العنوان الوطني غير متوفر |
| 4 | العلاقات: المدير مرتبط بأكثر من 3 كيانات | `REVIEW` | إشارة شبكة تستدعي المراجعة |
| 5 | ما عدا ذلك | `PASS` | استوفى المتطلبات |

**`tenant_id` قابل للتخصيص.** إنجاز لها مجموعة قواعدها، وشركة تأمين لها مجموعتها، على نفس المنتج. هذا هو الجزء الذي لا يستطيع أي مزود بيعه.

---

## 8. شكل الـAPI

المظروف واحد، والحمولة متغيرة:

```http
POST /v1/verifications
{
  "product": "ADDRESS_ONLY",
  "subject": { "unn": "7001272184" },
  "reference": "ENJ-ONB-88213"
}
```

```http
POST /v1/verifications
{
  "product": "IBAN_OWNERSHIP",
  "subject": {
    "iban": "SA0380000000608010167519",
    "identifier": { "type": "NATIONAL_ID", "value": "10••••••••" }
  },
  "reference": "ENJ-PAYOUT-441"
}
```

```http
POST /v1/verifications
{
  "product": "KYB_COMPLETE",
  "subject": {
    "cr_number": "1010478213",
    "manager": { "id": "10••••••••", "id_type": "NATIONAL_ID" }
  },
  "reference": "ENJ-ONB-88213"
}
```

والاستجابة **بنفس البنية دائماً**:

```json
{
  "verification_id": "vrf_01J...",
  "product": "KYB_COMPLETE",
  "status": "PARTIAL",
  "decision": "REVIEW",
  "decision_reasons": [
    { "code": "AOA_UNAVAILABLE", "message_ar": "عقد التأسيس غير متوفر لهذا الكيان" }
  ],
  "entity_id": "ent_01J...",
  "results": {
    "cr":      { "status": "OK",      "authority": "Commercial Registry" },
    "address": { "status": "CACHED",  "authority": "National Address" },
    "aoa":     { "status": "NOT_FOUND" },
    "manager_auth": { "status": "SKIPPED", "reason": "depends_on:aoa" },
    "ubo":     { "status": "OK",      "authority": "Commercial Registry" }
  },
  "profile_url": "https://verify.nx.sa/entities/ent_01J...",
  "evidence_url": "https://verify.nx.sa/evidence/vrf_01J....pdf",
  "billing": { "units": 1, "amount": 44.00, "currency": "SAR" }
}
```

**نقاط التصميم:**

- `results` بمفاتيح `step_key`، فالعميل يعرف بالضبط ما نجح وما لم ينجح.
- `authority` هو الجهة الرسمية، ولا يظهر اسم المزود إطلاقاً.
- `billing.amount` يظهر في الاستجابة نفسها، فلا مفاجآت في نهاية الشهر.
- `profile_url` يربط العملية بالملف التراكمي، وهو ما يحوّل الاستجابة من نتيجة عابرة إلى مدخل لسجل حيّ.

### نقطة نهاية اكتشاف المنتجات

```http
GET /v1/products
```

تُرجع لكل منتج: الكود، الاسم، `input_schema`، والسعر السائد لهذا العميل. **يولّد نموذج العميل واجهته منها آلياً**، فلا يحتاج تعديل كود عنده حين تضيف منتجاً جديداً.

---

## 9. ما الذي يشتريه هذا التصميم

| بدون طبقة المنتجات | معها |
|---|---|
| منتج جديد = إصدار برمجي | منتج جديد = صفوف في قاعدة البيانات |
| مدخلات موحدة قسراً، وحقول فارغة | مخطط مدخلات لكل منتج، ورفض مبكر بلا تكلفة |
| فشل خطوة = فشل الطلب | نجاح جزئي بفوترة عادلة |
| كاش على مستوى المنتج | كاش على مستوى الخطوة، ووفر أعلى بكثير |
| قرار واحد لكل العملاء | مجموعة قواعد لكل عميل |
| العميل يعدّل كوده مع كل منتج | يكتشف المنتجات من `/v1/products` |

**الأثر التجاري:** حين تطلب إنجاز منتجاً مخصصاً في الاجتماع، يكون جوابك "نضيفه خلال يومين" لا "ندرجه في خارطة الطريق". هذي الجملة وحدها تُغلق صفقات.

---

## 10. تعديلان على المخطط الأساسي

1. `verification_runs.status` أضيفت إليه الحالة `PARTIAL`.
2. أُضيف جدول `run_steps` كأبناء لعملية التحقق، ويحمل الحالة والتكلفة والفوترة على مستوى الخطوة.

وجدول `product_map` في القسم 9 من المخطط الأساسي **يُلغى ويُستبدل** بـ`products` و`product_steps` و`step_field_map`.
