# Glossary

The vocabulary, in Arabic and English. Where a word means something specific here, the specific
meaning is what is given.

---

## The core ideas

| English | العربية | Means |
| --- | --- | --- |
| **Attestation** | إفادة | One fact about one entity, with the authority that said it and the moment it was observed. Written once, never edited. New knowledge is a new row |
| **Entity** | كيان | A subject: a business, a person, a freelancer, a bank account or a property. Resolved by its identifiers, never duplicated within one workspace |
| **Profile** | الملف | Not a table: a computed projection, the newest valid attestation per field path |
| **Freshness** | الحداثة | Pure arithmetic against a time to live. No call, no cost. A field ages on its own |
| **Product** | المنتج | A verification defined in the database: its input schema, its steps, and how their output becomes attestations |
| **Mode** | الوضع | `MANAGED`: we call with our credential and charge the balance. `BYOC`: the subscriber's credential, no query cost to us. Per (subscriber × source) |
| **Authority** | الجهة | The official body that issued a fact. This is the exposed field; the provider behind it is never named |
| **Decision** | القرار | `PASS`, `FAIL` or `REVIEW`, decided by the first matching rule, always with its reasons |
| **Evidence** | الدليل | A sealed Arabic document for a run: stored, hashed, signed, and served rather than regenerated |
| **Module** | الموديول | A named group of verification products that fills one section of a customer file. The unit a subscriber is sold and the unit staff switch: off for them, the section leaves their files and the API refuses its products together |
| **Risk signal** | مؤشر الخطر | One reason a customer's score is what it is, with the weight it added. A row, not a constant: the platform sets it and a subscriber may disagree, field by field |
| **Risk band** | حد الدرجة | Where a score stops being «منخفضة» and starts being «متوسطة» or «عالية». Moving it moves no score, only the word that describes it |

## People and places

| English | العربية | Means |
| --- | --- | --- |
| **Tenant, workspace** | المستأجر، مساحة العمل | One subscribing organisation. The unit of isolation |
| **Subscriber** | المشترك | The customer of this platform: a bank, a financier, a marketplace |
| **Customer** | العميل | Whom the subscriber verifies. A customer is an entity |
| **Related party** | طرف ذو علاقة | Somebody a customer file names: a manager, a partner, a liquidator, a guardian. Mentioned in somebody else's file, and never invoiced |
| **Console, portal** | الكونسول، البوابة | The subscriber's screens |
| **Administration panel** | لوحة الإدارة | The platform's own screens: prices, subscribers, the data source. Its own role, connection and sign in |
| **Staff** | فريق الإدارة | Our people, with a role of `OWNER`, `PRICING`, `SUPPORT` or `READ_ONLY` |
| **Sandbox** | بيئة الاختبار | A second workspace, linked to its parent. Not a flag |

## Money

| English | العربية | Means |
| --- | --- | --- |
| **Wallet** | المحفظة | A prepaid balance, with an append-only ledger |
| **Hold** | حجز | Money committed to a run in flight, released if it does not complete |
| **Package, commitment** | الباقة، الالتزام | A term commitment drawn down by usage, not a monthly subscription |
| **Bundle** | حزمة رصيد | Prepaid operations with an expiry. Spent after the package and before the wallet |
| **Top-up** | شحن الرصيد | Credit bought by bank transfer, confirmed once by staff, with a tax invoice |
| **Halala** | هللة | One hundredth of a riyal. Some columns store halalas; the API always speaks riyals |
| **Margin** | الهامش | Price minus the cost of the call. Read from counters, never from runs |

## Running it

| English | العربية | Means |
| --- | --- | --- |
| **Run** | عملية التحقق | One execution of a product against a subject. Carries a readable reference, `VRF-2026-000019` |
| **Step** | خطوة | One provider call inside a run. A skipped or failed step is never billed |
| **Request** | الطلب | What somebody ticked on the console: a set of checks settled one at a time |
| **Check** | فحص | A product seen as a section of a customer file |
| **Monitor** | المراقبة | A scheduled re-verification with a budget it will not exceed |
| **Change event** | تغيّر مرصود | A detected difference between two attestations, with a severity |
| **Portfolio** | المحفظة (التصنيفية) | A saved grouping that carries policy: a default product, a ruleset, monitoring |
| **Batch** | الدفعة | A bulk re-verification, confirmed against the figure that was shown |
| **Onboarding case** | ملف التأهيل | An applicant's file: required checks, a deadline, waivers and an outcome |
| **Review case** | حالة المراجعة | A run a human must decide, with four eyes: the decider may not approve |
| **Awaiting** | بانتظار الجهة | A run whose source will answer later. Charged once, when the answer arrives |
| **Idempotency key** | مفتاح التكرار | Same key, same result, one charge |

## Identifiers

| English | العربية | Type |
| --- | --- | --- |
| **Commercial registration** | السجل التجاري | `CR` |
| **Unified number** | الرقم الموحد | `UNN` |
| **National identity** | الهوية الوطنية | `NATIONAL_ID` |
| **Residence permit** | الإقامة | `IQAMA` |
| **Freelance document** | وثيقة العمل الحر | `FREELANCE_DOC` |
| **IBAN** | الآيبان | `IBAN` |
| **Title deed number** | رقم الصك | `REAL_ESTATE_NO` |
| **Party document** | وثيقة الطرف | `PARTY_ID`, for an identity held by a document not modelled separately: an endowment deed, a licence, a passport |

Every one of them is stored as an HMAC for lookup and ciphertext for display, and never in plain
text.

## Security and operations

| English | العربية | Means |
| --- | --- | --- |
| **Row level security** | أمان مستوى الصف | The database refusing a row, not the code omitting it |
| **Guard** | حارس معماري | A test of something that may never be true. Changing one to pass is the defect |
| **Key version** | إصدار المفتاح | Which generation of the master key sealed a value. Several are readable, one is written with |
| **Sealed store** | مخزن الأسرار المختوم | Where a data source credential lives. The database holds only a `kms://` reference |
| **Heartbeat** | نبض العامل | A file the worker touches after every sweep, so a quiet worker is distinguishable from a dead one |
| **Retention** | الاحتفاظ | The sweep that destroys what is past its period, as the one role that may delete |
| **Credential version** | نسخة الاعتماد | A number in a panel session. Any credential change raises it and ends the sessions issued before |
