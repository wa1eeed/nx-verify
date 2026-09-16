# Changelog

Every change to NX Trust, newest first. The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The platform has not had a public release, so no version below is tagged in a registry. The
numbers are the project's own milestones, each one a state in which the platform did something
it could not do before. Dates are the dates the work landed on `main`.

Entries name what changed and why it mattered. Where a change fixed something that was quietly
broken, the entry says what was broken, because that is the part worth reading a year later.

---

## [Unreleased]

### Added

- **The documentation set, in English**, organised the way Diátaxis suggests: a tutorial from a
  clone to a verified customer, task guides, references for configuration, the database, the API
  and the scheduled tasks, and explanations of the architecture and the security model. The map
  is [docs/README.md](docs/README.md).
- **A new `README.md`** that says what the platform is, who it is for, and how to run it in
  fifteen minutes, and **`CONTRIBUTING.md`** with the loop, the style rules, the guards and the
  pull request checklist.
- **This changelog**, from the first commit onwards.
- **A test that keeps the API specification honest**: it asks the built server which routes it
  registered and fails when the document describes a route that does not exist, or misses one
  that does. The document had drifted by seven routes.

### Changed

- The worker closes its retention pool on shutdown, like its other two.

### Fixed

- **The OpenAPI document described seven routes fewer than the server has**: assigning and
  returning a review case, adding a portfolio member, creating, reading and cancelling a batch,
  and the inbound callback endpoint. It also omitted the 202 a verification returns when the
  source will answer later, and left `AWAITING` out of both status enumerations.
- **`NX-4021` was quoted as an example error code** in the specification and on the console's
  developer reference, and the platform has never been able to return it. There are nine codes
  and that is not one of them.
- `PORT`, `NX_SUPPORT_EMAIL` and `NX_MIGRATIONS_DIR` are read by the code and were missing from
  `.env.example`.

---

## [0.7.0] - 2026-09-16 - Security hardening

The security review of 2026-09-14 produced ten findings. This release closes the eight that
live in the repository. The two that remain (`SEC-08`, rotating a webhook secret exposed in a
conversation, and `SEC-09`, an independent penetration test and a PDPL review) are actions
outside the code.

### Added

- **A second factor on the administration panel (`SEC-02`).** Every member of staff proves
  twice: the password they know and a code from the authenticator they hold. Time based one
  time passwords to RFC 6238 (160 bit secret, 30 second step, six digits, HMAC-SHA1, one step
  of tolerance either side), written in `packages/core/src/auth/totp.ts` rather than taken
  from a library, and tested against the vectors in the specification.
- **Enrolment that cannot be postponed.** A member of staff without an authenticator enrols at
  the second step of their first sign in and reaches no screen until they do. Ten recovery
  codes are shown once, on the page that asked for them, and never again.
- **A sealed secret envelope** (`packages/core/src/crypto/secret-box.ts`): AES-256-GCM under a
  key derived from the deployment's master key, without the normalising the identifier
  envelope does, because a secret is bytes and must come back exactly as it went in.
- **A QR code drawn by the server** (`packages/core/src/auth/qr.ts`), so the enrolment address,
  which carries the secret, is never fetched from anywhere.
- **`credential_version` on every panel session (`SEC-04`, migration 0049).** A password
  change, a role change, a disabling or a reset authenticator raises it, and every session
  issued under an older version is refused on its next request. Whoever made the change keeps
  their own session and loses every other browser signed in as them.
- **A second cookie for the half finished sign in**, scoped to the panel's path, valid for ten
  minutes, which opens no screen: it says only that this account gave the right password a
  moment ago and what the second step is for.
- **Resetting an authenticator from the staff screen**, for somebody who lost their phone.
  Their sessions fall with it, and they enrol again at their next sign in. The staff table now
  shows who has enrolled and when.
- **Security headers on every response (`SEC-03`).** A content security policy with a nonce
  minted per response, so the framework's own inline scripts run and an injected one does not;
  `strict-dynamic` for the chunks a single page application loads; `nosniff`; a referrer
  policy; `X-Frame-Options: DENY` beside `frame-ancestors 'none'`; a permissions policy that
  closes the camera, the microphone, geolocation, payment and USB; HSTS in production only.
- **The same on the API**, with `default-src 'none'`: everything it answers is JSON except one
  sealed evidence document, which carries its own styles and no script of any kind. Every
  answer is `Cache-Control: no-store`, because each carries a customer's verification.
- **A dependency audit and a secret scanner in CI (`SEC-05`).** One job stops a merge on a
  production dependency with a known high or critical flaw, and on anything shaped like a
  credential in the working tree or anywhere in the repository's history. The scanner
  (`scripts/scan-secrets.sh`) is written here rather than pulled from an action, because a
  scanner reads every line of this repository including the ones not meant to leave it.
- **A secrets hygiene check for a deployment (`SEC-06`)**, `scripts/check-secrets-hygiene.sh`:
  file permissions, the length of the operator token, where the master key comes from, the
  database role passwords, and whether the file is tracked by git. It reads names and lengths,
  prints no value and sends nothing anywhere.
- **`docs/05-secrets.md`**: every secret, what it protects, where it lives, how to generate it,
  how to rotate it, and what to do the moment one leaks.
- **A heartbeat for the worker (`SEC-07`).** It touches a file after every sweep, and the
  container's health check reads how old that file is. No port is opened on the one process
  that holds the role which may delete, and the database is not asked anything, because a
  health check that needs the database calls the worker unhealthy every time the database
  blinks. It beats even when nothing was due: a quiet worker looks exactly like a dead one.
- **`restart: unless-stopped`** on every long running service in `docker-compose.yml`.

### Changed

- **A new API key, a new account's temporary password and a fresh share link no longer travel
  in the page address (`SEC-10`).** Each came back through a redirect, which left it in the
  browser's history, in the referrer of the next request and in the log of every proxy on the
  way. Each is now the result of the action that made it, reaching the screen that asked and
  nothing else. Two tests sweep the console tree to keep it that way.
- **A deployment refuses an operator token shorter than 32 random bytes**, checked at run time
  rather than only in a document. Outside production a shorter one is still allowed, because a
  developer's token opens a developer's database.
- The second step of a sign in is a screen of its own, `/operator/login/code`, and is part of
  the responsive sweep like every other screen.
- `verify/routes.mjs` gained a `door` visitor and an `expect` selector per route, so a route
  that quietly redirects somewhere else fails the sweep instead of passing as an empty page.

### Fixed

- **A finished enrolment lost its recovery codes.** The page rendered again with the action's
  result, asked to start a second enrolment for an account that had just finished one, and the
  refusal took the codes down with it, after they were already saved. Whether this is an
  enrolment is now read from the account rather than from the cookie, and opening the panel is
  its own action that starts the session once the codes have been kept. Caught by walking the
  browser, not by a test.
- **The page for an unknown address arrived with no JavaScript at all** under the strict
  policy: it was prerendered at build time, so its scripts carried no nonce and the policy
  refused every one of them. It is rendered per request now. Only a real production build
  showed this.

### Security

- `.env` is mode 600 and `.gitignore` refuses it. The scanner proves the whole history is clean.

---

## [0.6.0] - 2026-09-15 - Everything the registry returns

The owner's review of the customer file: the platform was reading about a third of what the
data source actually answers, related people had no place of their own, and identifiers were
masked on screens where the subscriber needs to read them.

### Added

- **Every field the source returns (ADR-128).** The adapter reads the whole of each answer:
  Hijri dates beside Gregorian, the breakdown of capital, contact details as the ministry
  records them, electronic stores, both boards, liquidators, the articles of the contract, and
  every address rather than the main one only. Each is a row in `step_field_map` and a labelled
  entry in the field catalogue, with its part, its format and its columns.
- **Three new roles and relations, and a new identifier type (migration 0048).** A liquidator
  (`LIQUIDATES`), a guardian of a minor partner (`REPRESENTS`), a branch's main registry
  (`BRANCH_OF`), and `PARTY_ID` for an identity held by a document the platform does not model
  (an endowment deed, a licence, a passport, a Gulf identity), stored hashed and encrypted like
  any other so it can never collide with a national identity or a registry number.
- **Related parties as a list and a file of their own (ADR-129).** Everybody the customer files
  name: managers, partners, liquidators and guardians, with their roles across establishments,
  how many of their powers are proven, and which of their establishments need attention.
  Searchable by name or by number through the hash.
- **A person's file shaped for a person**: their basic facts, then their roles in each
  establishment with the detail of each, and a verify button that runs in place for that
  establishment and that person alone.

### Changed

- **Identifiers are shown in full in the console (ADR-127, ADR-128, ADR-130)**: the commercial
  registration and unified number, the national identity and residence permit, the freelance
  document, the party document, and the IBAN, grouped in fours the way a bank prints it. In the
  public API and in a profile shared by link every identifier stays masked, and storage,
  logging and error messages are unchanged: a hash for lookup, ciphertext for display.
- A long section is read in parts with small headings, a companion fact sits inside the cell of
  the fact it belongs to, lists are tables or cards depending on their width, and the articles
  of a contract are folded by chapter.
- A fact that is true only inside one company stays in that company's file and is not shown as
  a section of the person's own.

### Fixed

- **A person's file showed company sections.** A manager's file offered «المدراء المفوضون»,
  «عقد التأسيس والملكية» and «شهادة العمل الحر», because facts about the person inside each
  company were being filed under that company's sections, and their name and nationality sat in
  the freelance group. Both are fixed: a `PERSON` group, and relationship paths excluded.
- **The income answer was read from the wrong place**, so an income verification recorded
  nothing.

---

## [0.5.0] - 2026-09-14 - The design system

A complete design handoff arrived. The owner approved building it over the working platform
rather than over mock data, and keeping the name NX Trust.

### Added

- **The Organic design system as the only source of appearance (ADR-113)**: tokens exactly as
  delivered, a component layer (`Button`, `Tag`, `Input`, `Segmented`, `Card`, `Table`,
  `Dialog`, and the rest) that every screen builds from, and a design check that refuses a
  colour, a radius, a shadow or a spacing written as a value.
- **shadcn/ui on Base UI and Tailwind v4 (ADR-119)**, with every one of its theme variables
  mapped to an Organic token, no preflight, and no arbitrary values.
- **A Saudi government palette (ADR-122)**: the national green for every action and everything
  verified, gold beside it, amber for what deserves a look, red for what failed, and cool greys
  for text and borders.
- **One typeface for the whole platform (ADR-125)**, IBM Plex Sans Arabic, as government
  platforms use.
- **Every screen on a phone and a tablet (ADR-126)**: under 1024px the sidebar becomes a
  drawer, no page scrolls sideways, and a table wider than its card scrolls inside it.
  `pnpm design:responsive` walks every screen at three widths.
- **Loading that says something (ADR-120)**: a progress bar across the top of the window, a data
  indicator in the frame, and a light passing over the loading shapes, all of which stop for a
  viewer who asked for less motion.
- **Clickable rows and paged lists** on every long table.
- **Verification in place**: a section of a customer file verifies without leaving the screen,
  and a field's history is told in stretches.
- **An intersections map** in the customer file, at the owner's request (ADR-123).

### Fixed

- **In dark mode two coloured cards kept their light fill under light text**, so their words
  disappeared. A screenshot caught it, not an assertion; every coloured surface now has a dark
  fill, and a test refuses one without it.
- **The formatter had rewritten the delivered token sheet**, so the commit that claimed a
  byte for byte copy was not one. The file was restored and excluded from formatting, and a
  test now proves the sheet starts with the delivered file exactly.
- **The freelance document number lost its dash to normalisation**, so re-verifying a
  registered freelancer was refused as the wrong shape.
- **A «not found» line about a previous number stayed on screen** while a new one was being
  searched, so a valid request was refused.
- **The worker exited with a zero after its first sweep.** The loop's timer did not hold the
  process, so every job ran once at startup and never again: retention, monitoring, notification
  delivery and request sweeps all silently stopped, and no restart policy said so.

---

## [0.4.0] - 2026-09-13 - A data source, and a panel to run it from

### Added

- **The registry data source as the provider the platform sells against (unit 72)**, with its
  cost as rows and a guard that refuses a price below the cost of the call it makes.
- **A provider's endpoint map as rows (unit 73)**, so connecting a new one needs no release.
- **The administration panel standing on its own (unit 74)**: its own database role, its own
  connection, its own sign in, and no screen that names a provider reachable from a subscriber
  session.
- **Data source credentials set from the panel (unit 75, ADR-108)**, written to a sealed store
  on a shared volume and never to a column, with a connection test and an audit trail.
- **The console as seven places, each with its own tabs (unit 76)**, and every old address
  redirecting to its new one.
- **The source's verification products as checks of a customer file (unit 77)**: eight checks
  as rows, including deeds marked «coming soon», and an error code of our own for every failure
  the source can return.
- **The customer file by section (unit 78)** with its indicators, and the links between
  customers it reveals.
- **Adding a customer by ticking checks (unit 79)**, with a cost estimate before anything runs.

---

## [0.3.0] - 2026-09-12 - The commercial platform

Thirty nine units that turned a verification engine into something a subscriber can buy, use
and administer, and an operator can install and run.

### Added

- **Provisioning as a command (unit 33)**, and a deployment proved by running it.
- **The console as a designed product (unit 35)** rather than seven separate pages, and a
  signed out page that offers no navigation (unit 36).
- **Packages and entitlements (unit 37)**, and the commercial model the blueprint describes
  rather than a monthly plan (unit 38).
- **An open banking adapter (unit 39)** and three verification modules as rows.
- **The five services sold separately (unit 40)**, and three ways to sell them.
- **A sandbox that is a workspace (unit 41)**, with documents that say so on their face.
- **The portal a subscriber lives in between verifications (unit 42)**.
- **A run number a person can read (unit 43)**, and the package as a purchase.
- **Deeds, one catalogue of fields, and an entity file with tabs (unit 44)**.
- **Onboarding as a file (unit 45)**, what a decided file sets off (unit 46), and the screens a
  team opens it with (unit 47).
- **Margin per customer per service (unit 48)** without reading a single run.
- **The developer surface (unit 49)**, with a key that cannot lie about which world it is in.
- **The commercial screen (unit 50)**, where a plan is edited and an exception is written down.
- **The request log (unit 51)**, including the refusals that were missing from it.
- **A run button that works in the sandbox and refuses everywhere else (unit 52)**.
- **The screen support opens while the customer is on the phone (unit 53)**.
- **A reference that cannot drift (unit 54)**, and a support screen that protects the customer.
- **Onboarding a merchant in one call (unit 56)**, proven end to end.
- **The owner's commercial decisions as rows (unit 57)**.
- **Connecting a provider from the panel, per environment (unit 58)**, without touching rule 10.
- **The provider calling us (unit 60)**: an inbound callback endpoint, and nothing else getting
  through it.
- **A run that waits (unit 61)**, charged once when the answer arrives.
- **The score as an instrument (unit 62)** rather than a figure in a box.
- **A verified profile a third party can open, and the subscriber can take back (unit 63)**.
- **A workspace the people in it can administer (unit 64)**.
- **Credit by bank transfer (unit 65)**: the subscriber asks, staff confirm it arrived.
- **The install guide asked of the running deployment (unit 66)**, and a readiness screen that
  distinguishes what blocks a launch from what merely warns.
- **The customer file over time (unit 69)**, where a person can read what changed and when.
- **One place for what needs attention (unit 70)**, with a count that means something.

### Changed

- **The console speaks the customer's words, not the schema's (units 68, 71)**: «entity» and
  its relatives left every screen a subscriber sees.
- **A temporary password is now temporary (unit 34)**.

### Fixed

- **A negotiated price was stored, shown, and never charged (unit 55).**
- **Retention was wired to a role that may not delete (unit 67)**, so the sweep was refused by
  the database on every run and the scheduler swallowed the error exactly as designed. The
  platform's promise that a customer's data is destroyed after the agreed period had never once
  been kept, and the test was green because it ran as the owner.
- **The API health check reported a healthy API as unhealthy**: inside the container
  `localhost` resolves to `::1` first, and the server binds IPv4.

---

## [0.2.0] - 2026-09-09 - From engine to product

### Added

- **The console (unit 8)**, with the interface rules asserted in tests.
- **A real provider adapter over HTTP (unit 9)**, proven against the abstraction.
- **Monitoring, change events, evidence and the worker (unit 10)**.
- **The decision engine (unit 11)**, the review queue with maker and checker (unit 12), and
  portfolios as the third level of every policy (unit 13).
- **Smart batches with a cost promise (unit 14)** rather than a cost preview.
- **The risk dashboard and the monthly report (unit 15)**, and the console screens for the queue,
  portfolios and risk (unit 16).
- **The operational API (unit 17)** for the queue, portfolios, batches and reports, so a
  compliance team can put the platform inside their own workflow.
- **Bundled evidence, and the score and network on the entity file (unit 18)**.
- **The rules studio (unit 19)**, with simulation before saving.
- **Users, roles and sessions (unit 20)**, password authentication and what a login form must
  not reveal (unit 21).
- **The provider chosen per subscriber from an operator panel (unit 22)**.
- **Key rotation (unit 24)**, which the platform had promised and could not do.
- **The evidence document (unit 25)**, rendered, sealed and served.
- **The MCP server (unit 26)**, deferred until the API stopped moving.
- **Single sign on through the subscriber's own directory (unit 27)**.
- **The console sign in, both doors and the way out (unit 28)**.
- **Notifications (unit 29)** that say something happened and never what.
- **The worker loop (unit 30)**, because nothing was running the jobs.
- **A key service adapter (unit 31)**, in the shape a key service actually has.
- **One image, three processes (unit 32)**, and a readiness check that can say no.

### Fixed

- **Provider health was never actually checked (unit 23)**, and routing depended on it.
- **Six schema and product claims in the documents that the build disproved.**

---

## [0.1.0] - 2026-09-08 - The foundation

### Added

- **The architecture and product specification**, and the twelve unbreakable rules.
- **Unit 0**: the monorepo, the migrations, row level security on every table with a
  `tenant_id`, and architecture guards 01 (attestations are immutable) and 02 (no query crosses
  tenants).
- **Unit 1**: identifiers stored as an HMAC for lookup and ciphertext for display, attestation
  writes, and the profile as a computed projection rather than a table.
- **Unit 2**: identity resolution, the freshness policy, and guard 07 (changing a time to live
  touches no attestation).
- **Unit 3**: the `VerificationProvider` interface, a stub provider, and guard 06 (no provider
  name in any public response).
- **Unit 4**: the product catalogue and step orchestration as a graph, and guard 08 (a failed
  optional step returns PARTIAL, not ERROR).
- **Unit 5**: normalisation through `step_field_map`, entities and relations, so a new product
  is rows and not a release.
- **Unit 6**: pricing, the wallet, settlement, and guards 03 (idempotency) and 04 (a skipped
  step is not billed).
- **Unit 7**: the public API with authentication, webhooks, and OpenAPI generated from the code.

<!-- No version here is tagged: these compare the commit each milestone ended at. -->

[Unreleased]: https://github.com/wa1eeed/nx-verify/compare/2933112...HEAD
[0.7.0]: https://github.com/wa1eeed/nx-verify/compare/aab5195...2933112
[0.6.0]: https://github.com/wa1eeed/nx-verify/compare/2c68333...aab5195
[0.5.0]: https://github.com/wa1eeed/nx-verify/compare/0c17db9...2c68333
[0.4.0]: https://github.com/wa1eeed/nx-verify/compare/371f9e9...0c17db9
[0.3.0]: https://github.com/wa1eeed/nx-verify/compare/cb381b7...371f9e9
[0.2.0]: https://github.com/wa1eeed/nx-verify/compare/92a66b8...cb381b7
[0.1.0]: https://github.com/wa1eeed/nx-verify/commits/92a66b8
