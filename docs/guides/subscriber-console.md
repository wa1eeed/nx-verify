# Using NX Trust: a subscriber's guide

For the people who use the console every day: what each screen is for, what the words on it mean,
and the few things that are not obvious.

The console is in Arabic and right to left. This guide names each screen in Arabic so you can
find it.

---

## Signing in

`/login`, with your email and password. If your company signs in through its own directory, use
your work email and you will be sent there and back.

A new account's password is temporary by construction: the console makes you change it before it
shows you a single screen, so the person who created your account never knows the password you
end up with.

---

## الرئيسية, the home

Four numbers, and what needs you.

- **What was verified**, this month and before.
- **What needs attention**: a customer whose registry expired, a change that nobody has looked
  at, a case waiting in the queue.
- **This month's usage** against what you are entitled to.
- **Recent operations**, newest first.

You can start a verification from here by typing a number: it does not travel through the address
bar, deliberately.

---

## العملاء, the customers

Every customer you have verified, with a completion bar, a status tag and a risk score.

**Searching** accepts a name, a registry number, a unified number, a national identity or an
IBAN. A number is matched by its hash, so the search works without any identifier ever being
decrypted.

**Filters** narrow by status, by what needs attention, and by portfolio.

Opening a row opens the file.

### The customer file

The centre of the product. It is not a record somebody maintains: it is what the platform knows,
each fact with the authority that issued it and the moment it was observed.

| Part | What it tells you |
| --- | --- |
| The head | Who this is, their identifiers in full, and four numbers: sections complete, powers proven, connections, and what needs a look |
| The sections | السجل التجاري, عقد التأسيس والملكية, المدراء المفوضون, العنوان الوطني, المعلومات المصرفية, شهادة العمل الحر, العقارات, الدخل الشهري. Each says where it came from and when |
| Each field | Its value, its authority, and its freshness |
| التقاطعات | Where this customer touches another: a shared manager, a shared address, a shared account |
| السجل الزمني | What each verification added, and how a field changed over time |

**درجة المخاطر** is never a number on its own. Every point in it has a line beside it saying
what added it and how much: a registry that is not active, a name that only partly matches, an
address five of your other customers are registered at. If a line looks wrong for your business,
say so to the platform team: the weights, the thresholds and the bands can all be set for your
workspace alone, and are read-only here by design.

**Three states you must not confuse.**

- **منتهي الصلاحية**, neutral: the fact has aged past its time to live. Look again.
- **تغيّر مرصود** or **تعارض**, amber: something actually changed. Somebody should read it.
- **فشل**, red: the verification did not work.

A section with a conflict carries its own «تحقق» button, so you can re-verify that section alone
without paying for the whole file.

**You will not see every section.** A file draws the sections your workspace was sold. A module
your organisation does not have simply is not there: no locked card, no upgrade prompt, and it
is not counted against how complete the file is. العقارات and الدخل الشهري are add ons, so most
workspaces will not see them, and الدخل الشهري belongs to a person's file (a sole establishment
or a freelancer) rather than to a company's, because a company's income is revenue and a
different question. Ask the platform team to switch a module on; it cannot be turned on from
here.

### Verifying

«تحقق جديد» or the button on a section. You tick which checks you want, and the estimated cost is
shown before anything runs. Each check settles on its own: the file fills section by section as
the answers arrive, rather than all at once at the end.

A check that fails is not charged. A check that the source cannot answer right now is retried,
and still not charged until it succeeds.

### Sharing a file

«مشاركة الملف» opens a link that shows a third party only the parts you tick, for as long as you
choose.

Two things to know. **Nothing is ticked to begin with**, on purpose: a default of everything is
how a bank that asked about an account ends up holding the owner's property deeds. And **the link
is shown once**. It cannot be read back, from this screen or from our database, because a link
that can be recovered is a link that never really expires. If it is lost, withdraw it and issue
another.

Every link on the list can be withdrawn, with the date it was last opened beside it. Sharing
without revoking is publishing.

---

## الأطراف ذات العلاقة, related parties

Everybody your customer files name: managers, partners, liquidators, guardians, and the
organisations among them.

A person's file shows their identifier in full, their roles across establishments with the detail
of each, how many of their powers are proven, and which of their establishments need a look. It
does **not** show company sections: a fact that is true only inside one company stays in that
company's file.

These people are not customers. They are not billed, and they are not in the customers list.

---

## التنبيهات, the alerts

Everything that needs a decision, in one place: expiring fields, detected changes, cases in the
queue. The unread count means something, because it is what nobody has looked at rather than what
exists.

---

## المراجعة, the review queue

A verification that came back `REVIEW` waits here.

Four eyes: the person who decides a case cannot approve it. A decision needs a written reason,
and that reason is the one free text field in the whole platform, because a decision without a
reason is a decision nobody can defend later.

An approver who disagrees returns the case to the queue with their reason, rather than approving
it to keep the queue moving.

---

## التحققات, the verifications

Every run, with its reference (`VRF-2026-000019`), its decision and its document. A failed run is
here too, with what went wrong.

The **document** is the sealed evidence: an Arabic page with a verification code and a QR that
anybody can check without an account. It is served exactly as it was sealed, never regenerated,
so a printed copy keeps matching.

---

## الفوترة, the billing

Your balance, what you have spent, your invoices and your prices.

- **A top-up** is by bank transfer: you ask, we confirm it arrived, and the tax invoice belongs to
  the top-up. What comes after it is a statement, not an invoice, because VAT is due when credit
  is bought and not when it is spent.
- **Your prices** are per product, without VAT.
- **Spending order**: your package first, then any bundle, then the wallet.

---

## الإعدادات, the settings

| Screen | For |
| --- | --- |
| المستخدمون | Who is in your workspace, and what each may do. An administrator adds people; nobody can disable their own account or remove the last administrator |
| الإشعارات | Which address hears about what, at what severity. Nothing is sent to an address that has not been proved |
| مفاتيح الربط | API keys. The secret is shown once and cannot be recovered; the prefix is what support can safely quote |
| الحداثة | How long each kind of fact stays fresh for you, over the platform's defaults |
| المحافظ | Saved groupings that carry policy: a default product, monitoring, alerts |
| القواعد | Your own decision rules, simulated against your real history before you switch them on |
| الدعم | How to reach us, and what to send: the `request_id` from any error finds the call in seconds |

---

## The four roles

| Role | May |
| --- | --- |
| مطّلع | Read files. Change nothing |
| محلل | Run verifications and decide review cases |
| معتمِد | Everything a محلل may, and approve what they decided |
| مسؤول | Everything, and manage users, keys and settings |

---

## Things worth knowing

- **An identifier is shown in full** in your console, because the customer is yours. In the public
  API and in a profile you share by link, every identifier is masked.
- **Nothing here was typed by a person.** Every field carries an authority and an observation
  time, which is why there are no notes and no manual fields.
- **A verification you repeat with the same key is not charged twice.**
- **Data is destroyed on a clock**, by default after five years, and the destruction is itself
  recorded.
