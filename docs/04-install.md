# تركيب البيئتين: الاختبار والإنتاج

هذا الملف يشرح كيف تُركَّب المنصة من الصفر: بيئة اختبار أولاً، ثم بيئة إنتاج. الترتيب مقصود. البيئة الحقيقية تُفتح بعد أن تكون بيئة الاختبار قد أجابت على نداء واحد على الأقل إجابة صحيحة.

المرجع للقواعد التي لا تُكسر هو `../CLAUDE.md`. ما هنا تطبيقها لا استثناء منها.

---

## المبدأ: بيئة واحدة في النشر، بيئتان في البيانات

المنصة لا تُنشَر مرتين. النشر واحد، والبيئتان صفّان:

| ما يختلف | كيف |
|---|---|
| عنوان المزوّد واعتماده | صف في `provider_connections` لكل (مزوّد × بيئة) |
| مساحة عمل المشترك | مساحة اختبار مرتبطة بمساحته عبر `tenants.sandbox_of`، والعزل بـRLS لا بعمود |
| مفتاح المشترك | `nx_test_…` يصل إلى الاختبار وحده، و`nx_live_…` يصل إلى الإنتاج وحده |
| البيانات | الاختبار يجيب من بيانات منشورة، والإنتاج يصل إلى الجهة الرسمية |

**العقد واحد في البيئتين.** نفس المسارات، نفس الحقول، نفس رموز الأخطاء. كل استجابة تحمل `environment` بقيمة `sandbox` أو `live`، والفرق في هذا الحقل وفي البيانات لا في الشكل. من يكتب تكاملاً على بيئة الاختبار لا يُعيد كتابته للإنتاج.

---

## الجزء الأول: بيئة الاختبار

### ١. ارفع الخدمات

```bash
export NX_POSTGRES_PASSWORD='<كلمة مرور قوية>'
docker compose up -d db
docker compose run --rm migrate
docker compose up -d api console worker
```

`migrate` يشتغل بدور `nx_migrator` المالك، والخدمات تشتغل بدور `nx_app` بلا BYPASSRLS وبلا ملكية. هذا ليس تفصيلاً: دور واحد يجعل اختبارات العزل تمر زوراً (قاعدة ١٢).

### ٢. ابذر الكتالوج

```bash
docker compose run --rm --no-deps api pnpm provision products:seed
```

يكتب المنتجات وخطواتها وخرائط حقولها، والباقات، وكتالوج المزودين. المنتجات صفوف لا كود (قاعدة ٨)، والباقات لازمة لأن الاستحقاق يُفحص قبل كل عملية: مساحة بلا باقة لا تشغّل شيئاً.

### ٣. اضبط اتصال بيئة الاختبار

من اللوحة: `/operator/connections` برمز المشغّل في ترويسة `x-nx-operator-token` أو كعكة `nx_operator`.

أو بالسطر، وهو الأنسب لنشر يُراجَع في طلب تغيير:

```bash
docker compose run --rm --no-deps api pnpm provision provider:connect \
  --provider stub --environment sandbox --kind stub
```

`stub` يجيب من بيانات الاختبار المنشورة ولا يصل إلى أي جهة. هذا هو الاتصال الصحيح لبيئة الاختبار حتى لو كان لديك حساب Sandbox عند المزوّد: بيانات منشورة تعني أن كل حالة حافة يمكن استدعاؤها متى شئت.

إن كان لديك حساب Sandbox حقيقي عند مزوّد سجلّي:

```bash
docker compose run --rm --no-deps api pnpm provision provider:connect \
  --provider wathq --environment sandbox --kind http \
  --base-url https://sandbox.<provider>.sa \
  --ref kms://providers/wathq/sandbox
```

ومزوّد الخدمات المصرفية المفتوحة يحتاج عنوانين:

```bash
docker compose run --rm --no-deps api pnpm provision provider:connect \
  --provider lean --environment sandbox --kind openbanking \
  --base-url https://sandbox.leantech.me \
  --auth-url https://auth.sandbox.leantech.me/oauth2/token \
  --ref kms://providers/lean/sandbox
```

**`--ref` مؤشر لا سر.** العمود يرفض أي قيمة لا تبدأ بـ`kms://` (قاعدة ١٠). السر نفسه لا يدخل قاعدتنا ولا نسخها الاحتياطية.

### ٤. ضع السر في مخزنه

المخزن يُختار بمتغيّر البيئة:

| النشر | المتغيّر | الكتابة من اللوحة |
|---|---|---|
| تطوير محلي | `NX_SECRETS` بصيغة JSON | لا. اللوحة تقول ذلك صراحةً ولا تتظاهر بالحفظ |
| إنتاج | `NX_SECRETS_ENDPOINT` و`NX_SECRETS_TOKEN` | نعم، وحقل السر في اللوحة يكتب مباشرةً في المخزن |

محلياً:

```bash
export NX_SECRETS='{"kms://providers/lean/sandbox":{"clientId":"…","clientSecret":"…"}}'
```

في الإنتاج اللوحة تكتب السر بنفسها، ولا يُعرض بعد حفظه، ولا يمر على أي جدول عندنا.

### ٥. أنشئ أول مساحة عمل ومفاتيحها

```bash
docker compose run --rm --no-deps api pnpm provision tenant:create \
  --name "شركة العميل" --slug acme --admin-email admin@acme.sa
docker compose run --rm --no-deps api pnpm provision package:assign \
  --tenant <TENANT_ID> --package ESSENTIAL
docker compose run --rm --no-deps api pnpm provision sandbox:create --tenant <TENANT_ID>
docker compose run --rm --no-deps api pnpm provision key:issue \
  --tenant <SANDBOX_TENANT_ID> --name integration
```

المفتاح يُطبع مرة واحدة ولا يُخزَّن بصيغة تُقرأ. البيئة على المفتاح تتبع مساحة العمل ويفرضها مُشغّل في قاعدة البيانات، فلا يمكن إصدار مفتاح `nx_test_` على مساحة إنتاج ولا العكس.

### ٦. تحقّق

```bash
curl -X POST http://localhost:3000/v1/verifications \
  -H "authorization: Bearer nx_test_…" \
  -H "content-type: application/json" \
  -H "idempotency-key: $(uuidgen)" \
  -d '{"product":"KYB_COMPLETE","subject":{"unn":"7001272184"}}'
```

يجب أن تُرجع `"environment":"sandbox"` ومرجعاً بالشكل `VRF-2026-000001`.

ثلاث حالات تستحق التجربة قبل أن تقول إن البيئة جاهزة: `7000000010` سجل منتهٍ، `7000000000` رقم بلا كيان، `7000000003` استجابة ناقصة الحقول. القائمة كاملة في `/developer`.

ولفرض جواب بعينه بدل البحث عن مُدخل ينتجه:

```
X-NX-Test-Scenario: expired_cr
```

مفتاح الإنتاج يتجاهل هذه الترويسة تماماً. لو احترمها لصار بإمكان المستدعي أن يختار نتيجته، ولفقدت كل نتيجة من المنصة معناها.

---

## الجزء الثاني: بيئة الإنتاج

لا تبدأ هنا قبل أن يكون نداء الخطوة ٦ قد نجح.

### ١. ما يجب أن يختلف عن التطوير

| المتغيّر | لماذا |
|---|---|
| `NX_SECRETS_ENDPOINT` | مطلوب في الإنتاج. المنصة ترفض الإقلاع على مخزن بيئة |
| `NX_MASTER_KEY` | مفتاح جذر بنمط المظروف. تدويره يفتح إصداراً جديداً ولا يمس إفادة قائمة |
| `NX_OPERATOR_TOKEN` | لا يقل عن ٢٤ محرفاً، ويُقارَن بزمن ثابت |
| `NX_OPERATOR_DATABASE_URL` | دور `nx_operator`: يعبر المشتركين للإعداد فقط ولا يقرأ إفادة ولا كياناً ولا عملية |
| `NX_POSTGRES_PASSWORD` | غيّرها. ولا تشارك حجم بيانات بين نشرين |

### ٢. اضبط اتصال الإنتاج

نفس الأمر، ببيئة `live` ومرجع اعتماد مختلف:

```bash
docker compose run --rm --no-deps api pnpm provision provider:connect \
  --provider wathq --environment live --kind http \
  --base-url https://api.wathq.sa \
  --ref kms://providers/wathq/live
```

**مرجع منفصل لكل بيئة.** مشاركة المرجع بين البيئتين تعني أن تدوير سر الاختبار يوقف الإنتاج.

### ٣. اربط المشترك بالمزوّد

الاتصال يقول أين المزوّد. الربط يقول من يُخدَم به وبأي وضع:

```bash
docker compose run --rm --no-deps api pnpm provision provider:bind \
  --tenant <TENANT_ID> --provider wathq --mode MANAGED --ref kms://providers/wathq/live
```

`MANAGED` يعني الاستدعاء باعتمادنا والخصم من رصيد المشترك عندنا. `BYOC` يعني الاستدعاء باعتماد المشترك ولا تكلفة استعلام علينا. الوضع على مستوى (مشترك × مزوّد) لا على مستوى المشترك.

### ٤. السعر والباقة قبل أول نداء

```bash
docker compose run --rm --no-deps api pnpm provision price:set \
  --tenant <TENANT_ID> --product KYB_COMPLETE --amount 44.00
docker compose run --rm --no-deps api pnpm provision wallet:topup \
  --tenant <TENANT_ID> --amount 5000 --invoice INV-2026-001
```

الأسعار بالريال بلا ضريبة. الضريبة تُستحق عند شحن الرصيد لا عند استهلاكه، ولذلك الشحنة لها فاتورة ضريبية وما بعدها كشف لا فاتورة.

منتج بلا سعر مرفوض، وهذا مقصود: عملية تشتغل بلا سعر هي عملية لا أحد يعرف من يدفع ثمنها.

### ٥. تحقّق من الإنتاج

```bash
curl -X POST https://api.<domain>/v1/verifications \
  -H "authorization: Bearer nx_live_…" \
  -H "content-type: application/json" \
  -H "idempotency-key: $(uuidgen)" \
  -H "X-NX-Test-Scenario: not_found" \
  -d '{"product":"ADDRESS_ONLY","subject":{"unn":"<رقم حقيقي>"}}'
```

الترويسة موضوعة عمداً: يجب أن تُتجاهَل. إن رأيت `NOT_FOUND` فالمفتاح ليس مفتاح إنتاج، أو البيئة مضبوطة خطأً. أوقف الإطلاق.

ثم راجع `/operator/health` و`/operator/margin`: الأولى تقول هل المزوّد يجيب، والثانية تقول هل السعر أعلى من التكلفة.

---

## ما يجب أن يظل صحيحاً بعد التركيب

هذه ليست نصائح. أي واحدة منها مكسورة تعني تركيباً غير مكتمل.

1. لا سر في أي صف. `credential_ref` يبدأ بـ`kms://` والعمود يرفض غيره.
2. لا اسم مزوّد في أي استجابة يراها مشترك. المكشوف `authority` وهو الجهة الرسمية.
3. لا رقم هوية صريح في عمود ولا سجل ولا رسالة خطأ ولا نسخة احتياطية.
4. مفتاح `nx_test_` لا يصل إلى الإنتاج، ومفتاح `nx_live_` يتجاهل ترويسة الحالة.
5. كل POST يقبل `Idempotency-Key` ويحترمه: نفس المفتاح نفس النتيجة ورسم واحد.
6. `docker compose down -v` يمسح الحجم. لا تشغّلها على نشر فيه بيانات.
