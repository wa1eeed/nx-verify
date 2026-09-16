# Using the administration panel: a staff guide

The platform's own screens: prices, subscribers, balances, the data source and the team. No
subscriber can reach any of it.

---

## Getting in

`/operator/login`, and it takes two things.

1. **Your email and password.**
2. **A code from your authenticator.** If you have not enrolled one, you do it here, and you reach
   no screen until you have. Scan the code or type the key, enter the six digits.

You are then shown **ten recovery codes**. Keep them somewhere safe. They are shown once, each
works once, and nobody can produce them again. If you lose both your phone and the codes, an
owner resets your authenticator and you enrol afresh.

Changing your password, or having your role changed, ends every other session signed in as you.
That is intended: it is the fastest way to close a door.

---

## The four roles

| Role | May |
| --- | --- |
| **مالك** (`OWNER`) | Everything, including the team and their roles |
| **التسعير** (`PRICING`) | Prices, bundles, packages, verification settings |
| **الدعم** (`SUPPORT`) | Subscribers, balances, top-ups |
| **قراءة فقط** (`READ_ONLY`) | Read. Change nothing |

The panel always keeps at least one active owner, and refuses the change that would leave none.

---

## نظرة عامة, the overview

What needs an action: top-ups waiting to be confirmed, subscribers near their limit, a data
source that is not answering, anything blocking a launch.

---

## المشتركون, the subscribers

Every workspace with its package, its expiry, its balance and its usage.

**Adding one** creates the workspace and its administrator, with a temporary password shown once.
Hand it over by a channel you trust. They will be made to change it at their first sign in, so
you never know their password.

**Opening one** shows their packages, their prices, their exceptions, their keys, their usage and
their people. From here you can suspend them, move them to another package, or write an exception
against their standard price.

**Their modules** sit on the same page, one switch each. A module is a named group of
verification services that fills one section of a customer file, and the switch is what a
subscriber is actually sold. Switching one off does three things at once, which is why the card
says so before you press anything: the section leaves every customer file they open, the checks
leave their request screen, and the API refuses those services.

The **source** column beside each switch is worth reading. Nothing is copied onto a subscriber
when they are created, so a module reads as **من الباقة** or **الافتراضي** until somebody
decides for them, and only then as **قرار خاص بهذا المشترك**. That is how, a year later, a
deliberate choice is still distinguishable from a default that has since changed. **رفع القرار**
removes the decision rather than turning the module off, and returns them to their plan.

السجل التجاري cannot be switched off for anybody: without it there is no customer file to draw,
and the attempt is refused rather than quietly ignored.

### الحوالات, the top-ups

A subscriber asks for credit, and you confirm it arrived. Confirming needs the tax invoice number
and cannot be undone, because it moves money. What was confirmed, by whom and when is in the
trail.

---

## الأسعار, the prices

Per product: our cost, the list price, and the margin between them.

**A price below its cost is refused.** Not warned about: refused. The cost is data, read from
what the source actually charges per call, so the margin on the screen is real.

A price is never edited. A new price closes the old row and opens a new one, so an invoice from
March can still be recomputed in September.

Also here: **credit bundles** (prepaid operations with an expiry) and **packages** (a term
commitment drawn down by usage, not a monthly subscription).

### الموديولات, the modules

The catalogue of what the platform sells as units: what each module adds to a customer file,
the services inside it, and whether each of those shows in the file or is sold only through the
API.

Two modules are **add ons**, off unless somebody gives them: **العقار** and **الدخل**. Every
plan names a price for them and includes neither, so the agreed rate is already there when you
switch one on.

The figure to watch is **خرجت عن الباقات**: how many subscribers were decided for by hand in
each module. A module switched by hand for thirty subscribers is a module that belongs in a
plan, and a plan nobody takes as written is a plan to redraw.

---

## إعدادات التحقق, the verification settings

| Setting | Means |
| --- | --- |
| عدد المحاولات | How many times a check is retried before it fails. Between 1 and 5 |
| مدة الصلاحية | The default lifetime of a result, when nothing more specific applies |
| حد تطابق الاسم | How close two names must be to count as the same |
| تنبيه انتهاء السجل | How many days before a registry expires to say so |
| الأقسام المطلوبة | Which sections each kind of customer needs, and in what order |

These reach every subscriber who has not overridden them.

---

## الربط التقني, the technical connection

Where the data source lives, per environment, and which credential opens it.

**The secret is written into a sealed store, never into our database.** After you save it, it is
not displayed again, and no table of ours has ever held it.

«اختبار الاتصال» calls the source and records the result. If a source calls us back instead of
answering, this is where its address is issued: opaque, naming no provider, and **rotating it
invalidates the old one immediately**, so do not press that unless the source's dashboard is open
in front of you.

---

## مراقبة المزودين, the health screen

Whether each source is answering, per subscriber binding. A source marked `down` is skipped by
routing and the next candidate is used.

A change of status is written into the trail, so «it was fine yesterday» has an answer.

---

## الجاهزية, the readiness screen

What is still missing before a launch: the key service, the secret store, the addresses, the bank
details, the deployment token. It orders what blocks a launch above what merely warns.

Open it after every configuration change, and before a first customer.

---

## التقارير, the reports

Revenue and provider cost per subscriber per product, read from counters rather than from
verifications. Nobody in this panel can read a customer's file, and that is by design: the role
this screen runs as has no grant on a single verification table.

---

## الصلاحيات والتدقيق, permissions and audit

**The team**: who may enter, with what role, whether they have enrolled an authenticator, and
when they last signed in. An owner adds a member, changes a role, suspends an account, sets a new
password, or resets a lost authenticator.

**Resetting an authenticator** ends that person's sessions and makes them enrol again at their
next sign in. It is the right answer to a lost phone.

**The trail**: every change any of us made. What changed, who changed it, and when. It holds
references, field names and figures, never material, and it is appended and read, never edited.

---

## Things worth knowing

- **This panel cannot read a customer's file.** Its database role has no grant on verifications,
  attestations, identifiers or entities. If a subscriber asks about a specific verification, the
  answer comes from their own request log, by request id.
- **No screen here names a data source to a subscriber**, and no subscriber session can reach any
  of these screens at all.
- **The deployment token makes the first owner and nothing else.** After that it only seals
  sessions, and rotating it signs everybody out at once.
- **Every screen works on a phone.** The sidebar becomes a drawer under 1024 pixels.
