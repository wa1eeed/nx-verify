# ابدأ من هنا — كيف تستخدم هذه الحزمة في Claude Code

> تريد أن ينفّذ كلود كود المنصة كلها بنفسه من رسالة واحدة مع تحقق آلي بعد كل شاشة؟
> افتح **`AUTORUN.md`**. هذا الملف للتنفيذ اليدوي خطوة بخطوة.

ملفات التحقق الآلي في `verify/`: `check-design.mjs` (يرفض أي خروج عن التوكنات) و`shoot.mjs` (يصوّر الشاشات بعرض 1440 للمقارنة).

## محتويات الحزمة

```
design_handoff_verification_platform/
├─ START-HERE.md                  ← هذا الملف
├─ README.md                      ← مواصفات الشاشات بالتفصيل (المرجع الرسمي)
├─ CLAUDE.md                      ← قواعد إلزامية تُنقل إلى جذر المستودع
├─ screens/                       ← صور الشاشات السبع (مرجع بصري)
│  ├─ 00-information-architecture.png
│  ├─ 01-subscriber-dashboard.png
│  ├─ 02-new-verification-request.png
│  ├─ 03-customer-profile.png
│  ├─ 04-customers-list.png
│  ├─ 05-admin-pricing-settings.png
│  └─ 06-admin-subscribers-balances.png
├─ design-system/
│  ├─ styles.css                  ← التوكنات وفئات المكوّنات (انسخه إلى المشروع)
│  └─ readme.md                   ← دليل نظام Organic
└─ prototype/
   ├─ منصة التحقق.dc.html         ← النموذج الحي (افتحه في المتصفح)
   ├─ support.js
   └─ _ds/…
```

## خطوة 1 — ضع الملفات في المستودع

من جذر مشروعك:

```bash
unzip design_handoff_verification_platform.zip -d .
cp design_handoff_verification_platform/CLAUDE.md ./CLAUDE.md
mkdir -p src/styles
cp design_handoff_verification_platform/design-system/styles.css src/styles/organic.css
```

إن كان لديك `CLAUDE.md` أصلاً، ألحق محتوى الملف المرفق في نهايته بدل استبداله.

استورد ملف التوكنات مرة واحدة في جذر التطبيق (مثلاً `app/layout.tsx` أو `main.tsx`):

```ts
import "./styles/organic.css";
```

وأضف الخطوط في `<head>`:

```html
<link href="https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@500;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
```

## خطوة 2 — افتح النموذج بجانبك

افتح `design_handoff_verification_platform/prototype/منصة التحقق.dc.html` في المتصفح (مع بقاء `support.js` و`_ds/` بجانبه). هذا هو المرجع البصري النهائي — الصور في `screens/` للمراجعة السريعة فقط.

## خطوة 3 — الرسالة الأولى في Claude Code

الصق هذا كما هو:

```
اقرأ CLAUDE.md و design_handoff_verification_platform/README.md بالكامل قبل أن تكتب أي كود.

مهمتك الأولى فقط: بناء طبقة المكوّنات الأساسية في src/components/ui مطابقة تماماً
لفئات نظام Organic في src/styles/organic.css — Button (primary/secondary/ghost/icon/block),
Tag (accent/accent-2/neutral/outline), Input, Field, Radio, Segmented, Card, Table, Dialog.

القواعد: كل لون ومقاس ونصف قطر وظل من var(--*) فقط، لا قيمة مباشرة واحدة.
لكل عنصر تفاعلي hover و:active و:focus-visible كما هو معرّف في النظام.
لا تبنِ أي شاشة في هذه المهمة. أرِني الملفات ثم توقّف.
```

## خطوة 4 — الشاشات، واحدة في كل مرة

لا تطلب أكثر من شاشة في الرسالة الواحدة. القالب:

```
نفّذ الشاشة «03 — ملف العميل» من design_handoff_verification_platform/README.md.
الصورة المرجعية: design_handoff_verification_platform/screens/03-customer-profile.png

استخدم مكوّنات src/components/ui فقط — لا تنشئ أزراراً أو وسوماً مخصّصة.
النصوص العربية في المواصفات هي النص المعتمد، لا تُعِد صياغتها.
اتبع القيم الحرفية: أنصاف الأقطار، المسافات، مقاسات الخط، وألوان كل حالة.
نفّذ حالات التحميل والفراغ والخطأ.
في النهاية مرّ على «قائمة الفحص النهائية» في آخر README.md وأجب على كل بند.
```

الترتيب المقترح: 03 ملف العميل ← 02 طلب التحقق ← 01 اللوحة الرئيسية ← 04 قائمة العملاء ← 05 الأسعار والإعدادات ← 06 المشتركون والأرصدة. (ابدأ بملف العميل لأنه يفرض شكل البيانات كلها.)

## خطوة 5 — المراجعة بعد كل شاشة

الصق هذا بعد انتهائه:

```
راجع ما نفّذته مقابل design_handoff_verification_platform/README.md:
1. ابحث في الكود الجديد عن أي hex أو rgb أو px مكتوب مباشرة واستبدله بتوكن.
2. تأكد أن الأزرار والحقول والوسوم 999px والبطاقات 26–28px.
3. تأكد أن العناوين Baloo Bhaijaan 2 والنص IBM Plex Sans Arabic.
4. تأكد من dir="rtl" ومحاذاة رؤوس الجداول يميناً والآيبان LTR.
5. تأكد أن كل الأيقونات Lucide بسماكة 2.75.
اذكر ما أصلحته.
```

## خطوة 6 — قيدان لا يُنسيان

اذكرهما صريحاً عند كل شاشة فيها إعدادات أو تكامل:

```
لا تذكر أي مزوّد بيانات خارجي في الواجهة، ولا تُنشئ أي حقل لمفاتيح API خاصة بالمشترك.
الخدمة تُقدَّم من المنصة مباشرة. مفاتيح الربط الظاهرة للمشترك هي مفاتيح منصتنا فقط.
```

## نصائح تحفظ التطابق على المدى الطويل

- أضف اختبار lint بسيط يرفض أي `#` لوني داخل `src/` خارج `styles/organic.css`.
- لا تدخل مكتبة مكوّنات جاهزة. إن كان لا بد، اربط ثيمها بالتوكنات أولاً في مهمة منفصلة.
- عند أي شاشة جديدة غير موجودة في الحزمة، اطلب من كلود اشتقاق تخطيطها من أقرب شاشة قائمة بدل الابتكار.
- عند أي تعديل تصميمي لاحق: عدّل النموذج أولاً، ثم اطلب التنفيذ. لا تدع الكود يصبح مرجعاً أحدث من التصميم.
