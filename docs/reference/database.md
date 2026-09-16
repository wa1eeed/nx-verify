# Database reference

What exists in the database: every table, its columns and constraints, the five roles, every row
level security policy, every vocabulary, and the 52 migrations that built it.

This describes what **is**. `docs/02-schema.md` describes what was **designed**, in Arabic, with
the reasoning. Where the two ever disagree, the migrations win and this page is the one that
matches them.

Source of truth: `packages/db/migrations/0001…0050_*.up.sql` and `packages/db/src/`.

---

## Conventions that hold everywhere

- Every object lives in `public`. Helper functions live in schema `app`, owned by `nx_migrator`
  except six owned by `nx_auth`. The migration ledger is `nx_meta.schema_migrations`, created by
  the runner rather than by a migration.
- Every migration after 0001 begins with `SET LOCAL ROLE nx_migrator`, so `nx_migrator` owns
  every table.
- A tenant-scoped foreign key is **composite**: `(tenant_id, <id>)` referencing a
  `UNIQUE (tenant_id, id)` on the parent. A cross-tenant reference is therefore impossible at
  storage level, not merely refused by a query (rule 2).
- Every tenant-scoped table is `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`.
  The owner is not exempt (rule 3).
- Money is `numeric` in riyals on the wallet and pricing path, and `bigint` halalas on the
  package, bundle and margin path. Always excluding VAT.
- There are **no PostgreSQL enums and no domains**. Every vocabulary is a `CHECK` constraint, so
  widening one is a migration that can be reviewed and rolled back.

---

## The anchor

```sql
CREATE FUNCTION app.current_tenant() RETURNS uuid
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$
  STABLE;
```

> Tenant in scope for the current transaction. NULL when unset, which denies everything.

Failure is closed: an unset context yields zero rows, never all rows. `withTenant()` sets it per
transaction with `set_config('app.tenant_id', …, true)`, so it cannot leak past a `COMMIT`.

---

## Tables

### Foundation

#### `tenants`

The subscribing workspace. Every other tenant-scoped row hangs off it. RLS: yes, on its own `id`.

| column             | type        | constraints                                                                             |
| ------------------ | ----------- | --------------------------------------------------------------------------------------- |
| `id`               | uuid        | PK, default `gen_random_uuid()`                                                          |
| `legal_name`       | text        | NOT NULL                                                                                 |
| `cr_number`        | text        |                                                                                          |
| `status`           | text        | NOT NULL default `active`                                                                |
| `data_region`      | text        | NOT NULL default `ksa`                                                                   |
| `retention_days`   | int         | NOT NULL default `1825`                                                                  |
| `review_sla_hours` | int         | NOT NULL default `48`, must be positive                                                  |
| `slug`             | text        | NOT NULL, `^[a-z0-9][a-z0-9-]{1,62}$`, unique                                             |
| `sandbox_of`       | uuid        | → `tenants(id)`, may not be itself, at most one sandbox per workspace                     |
| `created_at`       | timestamptz | NOT NULL default `now()`                                                                 |

Triggers: a default slug of `tenant-<12 hex>` on insert; a refusal of a sandbox of a sandbox
(`NX006`).

#### `entities`

A subject being verified, inside one tenant. RLS: yes.

`id` uuid PK · `tenant_id` uuid NOT NULL → `tenants` · `entity_type` text NOT NULL, one of
`BUSINESS`, `PERSON`, `FREELANCER`, `BANK_ACCOUNT`, `PROPERTY` · `display_name` text ·
`first_seen_at`, `last_seen_at` timestamptz NOT NULL default `now()` · `archived_at` timestamptz
(set by retention).

#### `attestations`

One immutable row per fact observed about an entity. Append only. RLS: yes.

| column          | type         | constraints                                                          |
| --------------- | ------------ | -------------------------------------------------------------------- |
| `id`            | uuid         | PK                                                                   |
| `tenant_id`     | uuid         | NOT NULL                                                             |
| `entity_id`     | uuid         | NOT NULL, composite FK to `entities`                                 |
| `field_path`    | text         | NOT NULL                                                             |
| `value`         | jsonb        | NOT NULL                                                             |
| `value_hash`    | bytea        | NOT NULL                                                             |
| `source`        | text         | NOT NULL. **Never projected** (rule 5)                               |
| `authority`     | text         | The official body, which is what a subscriber sees                   |
| `run_id`        | uuid         | NOT NULL                                                             |
| `observed_at`   | timestamptz  | NOT NULL                                                             |
| `valid_from`    | timestamptz  | NOT NULL                                                             |
| `valid_until`   | timestamptz  | Real expiry from the authority, when there is one                    |
| `confidence`    | numeric(4,3) | NOT NULL default `1.000`, between 0 and 1                            |
| `superseded_by` | uuid         | Composite FK to `attestations`, may not be itself                    |
| `evidence_id`   | uuid         |                                                                      |
| `created_at`    | timestamptz  | NOT NULL default `now()`                                             |

Two triggers hold rule 1: an UPDATE may change `superseded_by` and nothing else, once, or it
raises `NX001`; a DELETE raises `NX002` for every role but `nx_retention`.

#### `entity_identifiers`

National identities, registry numbers and IBANs, as a keyed hash plus ciphertext. Never plain
text (rule 4). RLS: yes.

`id_type` text NOT NULL (see the vocabulary below) · `id_value_hash` bytea NOT NULL, exactly 32
bytes, HMAC-SHA256 under a per-tenant key · `id_value_enc` bytea NOT NULL · `is_primary` boolean
· `key_version` int NOT NULL default 1 → `key_versions`, rewritten in place by rotation.

Unique on `(tenant_id, id_type, id_value_hash)`: that index is how a subject is resolved without
anything ever being decrypted for a lookup.

#### `freshness_policy`

Per-field time to live at three levels: system (`tenant_id IS NULL`), tenant, and portfolio.
Most specific wins. RLS: yes, read the defaults and write only your own.

`field_path` text NOT NULL · `ttl_days` int NOT NULL, positive · `weight` int NOT NULL default 10
· `portfolio_id` uuid, which requires a tenant.

Seeded system rows: migration 0007 set `cr.status` 7 days, `cr.core` 90, `address.national` 30,
`manager.signing_authority` 90, `iban.ownership` 180, `property.deed` 365. Migration 0045 added
ten more (`cr`, `contract`, `governance`, `manager.positions`, `manager.permissions`, `partner`,
`ownership`, `bank`, `account`, `person`) and 0048 added five (`manager`, `liquidator`,
`guardian`, `party`, `registry`).

#### `tenant_provider_binding`

Which provider serves a tenant, in which mode, with which credential reference. RLS: yes, plus
one cross-tenant operator policy for configuration.

`mode` text NOT NULL, `MANAGED` or `BYOC` · `credential_ref` text, which must start `kms://` and
be at most 200 characters (rule 10) · `rate_limit_rps` · `health_status`, one of `unknown`,
`healthy`, `degraded`, `down` · `last_tested_at` · `activated_at` · `priority` int default 100 ·
`endpoints` text[], NULL meaning every endpoint.

### Catalogue and runs

#### `products`

A verification product. Adding one is rows, never a release (rule 8). No tenant, no RLS.

`code` text PK · `name_ar`, `name_en` NOT NULL · `subject_type` · `input_schema` jsonb NOT NULL, a
JSON Schema validated before any provider is called · `is_composite` · `partial_policy`
(`ALL_OR_NOTHING` or `BEST_EFFORT`) · `decision_ruleset` uuid · `status` (`active`, `suspended`,
`retired`) · `valid_from`, `valid_to` · `profile_section` · `applies_to` text[] over `COMPANY`,
`ESTABLISHMENT`, `FREELANCER` · `check_order` int · `availability` (`AVAILABLE`, `COMING_SOON`) ·
`summary_ar`.

A check keeps `profile_section` and `applies_to` consistent: either both are set or neither is.

#### `product_steps`

The ordered provider calls a product is made of.

`product_code` + `step_key` PK · `seq` · `provider` · `endpoint` · `input_binding` jsonb, which
may only reference `$.subject.*`, `$.steps.<key>.*` or `literal:<value>` · `depends_on` text[] ·
`required` · `fallback_provider` · `cache_ttl_days` · `step_weight`.

A step may not depend on itself.

#### `verification_runs`

One execution of a product for one subject. RLS: yes.

`product_code` · `entity_id` · `client_ref` · `idempotency_key`, unique per tenant when set
(rule 7) · `mode_at_execution` · `provider_used` · `status` (`PENDING`, `AWAITING`, `OK`,
`PARTIAL`, `NOT_FOUND`, `ERROR`) · `decision` (`PASS`, `FAIL`, `REVIEW`) · `decision_reasons`
jsonb · `latency_ms` · `billable`, `billed_amount`, `provider_cost` · `triggered_by` (`API`,
`CONSOLE`, `MONITOR`, `BULK`) · `reference`, the human readable number, unique per tenant ·
`charge_source` (`PACKAGE`, `BUNDLE`, `WALLET`, `FREE`) · `requested_by` → `users` ·
`bundle_key`.

#### `run_steps`

Per-step outcome, and where rule 4 of billing lives. RLS: yes.

`status` is one of `OK`, `NOT_FOUND`, `ERROR`, `SKIPPED`, `CACHED`, `AWAITING`, `PENDING`. Three
checks say the same thing three times, one per status: a `SKIPPED`, an `ERROR` and an `AWAITING`
step must have `billable = false` and a zero amount. That is guard 04 written into the schema, so
a bug in the pricing code cannot bill for work that did not happen.

#### `step_field_map`

Maps a provider payload path onto our field paths, entities and relations. This is the
normalisation layer as data (rule 8). No tenant, no RLS.

`source_path` (one `[*]` wildcard allowed) · `field_path` · `entity_role` · `entity_type` ·
`identifier_path` · `identifier_type_source` · `relation_type` · `valid_until_path` ·
`confidence`.

A row for anything other than the subject must be resolvable: it needs both an identifier path
and an entity type, or the constraint refuses it.

#### `entity_relations`

A derived link between two entities, ended but never deleted. RLS: yes.

`from_entity`, `to_entity` (may not be equal) · `rel_type` · `attributes` jsonb ·
`attestation_id`, so every relation can name the observation that created it · `valid_from`,
`valid_until`, `ended_at`. One live relation of a given type between a given pair.

### Money

| Table          | What it holds                                                                                |
| -------------- | -------------------------------------------------------------------------------------------- |
| `cost_book`    | What a provider charges **us** per endpoint. No tenant may read it: it reveals margin          |
| `price_book`   | Versioned list and per-tenant prices. Rows are closed with `valid_to`, never edited (`NX003`)  |
| `wallets`      | One prepaid balance per tenant, with `held` for money committed to a run in flight             |
| `wallet_ledger`| Append only movements: `TOPUP`, `CHARGE`, `REFUND`, `EXPIRY`, `ADJUSTMENT`, `HOLD`, `RELEASE`. Any UPDATE or DELETE raises `NX004` |

A VAT invoice id may only appear on a `TOPUP` row, because VAT is due when credit is bought and
not when it is spent.

### API surface and audit

| Table                | What it holds                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `api_keys`           | A hashed key, its prefix, its scopes and its environment. A trigger forces the environment to match the workspace (`NX007`), so a test key cannot exist on a live workspace |
| `webhook_endpoints`  | A customer HTTPS sink and a `kms://` reference to its signing secret                                    |
| `webhook_deliveries` | One queued or attempted delivery, with `attempts` and `next_retry_at`                                   |
| `audit_log`          | The tenant's own trail. **Partitioned** monthly by `created_at`                                          |

`audit_log` is the only partitioned table. Each partition is independently enabled, forced and
given its own `t_isolation` policy by `app.prepare_audit_partition`, and
`app.create_audit_partition` makes one month. Nothing drops a partition: the worker creates the
current month and two ahead, and old partitions are kept.

### Monitoring, evidence and scores

| Table                   | What it holds                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `monitors`              | A scheduled, budget-capped re-verification. `spent_this_period` rolls over with the calendar month; exceeding the cap sets `budget_exhausted` rather than overspending |
| `change_severity_rules` | What a given field change means, as rows: system defaults plus per-tenant overrides                          |
| `change_events`         | A detected change between two attestations, its severity, and whether anybody acknowledged it                |
| `evidence`              | A sealed document for a run: storage key, content hash, signature, optional public token, and the key version that signed it. **Never rewritten**, because a document already shown to an auditor keeps its signature |
| `entity_scores`         | A score from 0 to 100 with its `breakdown`, which is NOT NULL: a score without its reasons is not allowed to exist |

### Decisions and review

`decision_rulesets` and `decision_rules` hold the ordered rules; the first matching condition
decides. The condition vocabulary is closed: `ne`, `eq`, `missing`, `stale`, `linked_gte`,
`always`. The seeded `KYB_DEFAULT` set carries the reason codes `CR_NOT_ACTIVE`,
`SIGNING_AUTHORITY_UNVERIFIED`, `ADDRESS_UNAVAILABLE`, `CR_STATUS_STALE`, `NETWORK_SIGNAL` and
`REQUIREMENTS_MET`.

`review_cases` is the maker and checker queue. It holds **the single free text field in the whole
system**, `decision_note`, which rule 6 allows by name. Its constraints are the interesting part:
`approved_by <> decided_by` (four eyes), a decision must arrive complete (outcome, decider, time
and a non-blank note together or not at all), approval must follow a decision, and a trigger
refuses a decision from anyone below ANALYST or an approval from anyone below APPROVER (`NX005`).

### Portfolios, batches, people, providers, notifications

| Table                                                                                     | What it holds                                                                     |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `portfolios`, `portfolio_members`                                                         | A saved grouping that carries policy: default product, ruleset, monitoring, alerts |
| `batches`, `batch_items`                                                                  | A bulk re-verification with a confirmed cost promise before it may leave DRAFT     |
| `users`, `user_sessions`, `user_credentials`, `login_attempts`                            | The subscriber's own people, sessions as hashes, scrypt passwords, lockout counting |
| `tenant_idp`, `sso_domains`, `user_identities`, `sso_login_requests`                      | Sign in through the subscriber's own directory, with PKCE and hashed state         |
| `provider_catalog`, `provider_connections`, `provider_endpoints`, `inbound_events`         | Providers, their per-environment connections, their endpoint maps as rows, and the callbacks they send |
| `key_versions`                                                                            | Key generations, with exactly one `active` at a time, so rotation is a job not an outage |
| `notification_channels`, `notification_rules`, `notification_deliveries`                   | A proved address, a subscription, and the rendered message with its attempts       |

`inbound_events` deliberately has **no tenant column**: a provider's callback arrives before
anybody knows whose it is. It is matched to a waiting run by digest, inside tenant scope.

### The commercial model

`packages` and `package_products` define what is sold; `tenant_commitments` records what a
subscriber signed (a term commitment drawn down by usage, not a subscription);
`tenant_product_overrides` holds a per-subscriber exception; `product_usage` counts runs per
calendar month for quota checks; `margin_counters` aggregates revenue and provider cost so staff
can read margin without reading a single run.

### Modules

`modules` is the unit a subscriber is sold: a named group of verification products that fills
one section of a customer file. `products.module_code` is NOT NULL, so no product can exist
outside a module and therefore outside anybody's ability to grant or refuse it.
`tenant_modules` is the switch for one subscriber, with who decided and when.

| Column               | Meaning                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `modules.section`    | The customer-file section it draws, UNIQUE. NULL is a module sold only through the API          |
| `modules.core`       | Cannot be switched off for anybody: without it there is no file to draw. Refused with `NX-4003` |
| `modules.default_on` | What a subscriber gets when nobody has decided and their plan is silent. False for an add on    |

The entitlement cascade, most specific first. Every consumer uses the same order, and both
`listChecks` and `resolveEntitlement` implement it:

1. `tenant_product_overrides.enabled`: one product for one subscriber, the scalpel
2. `tenant_modules.enabled`: the module for one subscriber, the switch
3. `package_products.enabled`: what their plan sells
4. `modules.default_on`: what the module is worth to somebody nobody has decided about

A core module answers true whatever any row says. Nothing is copied onto a subscriber when they
are created: they inherit until somebody decides, which is what keeps a deliberate choice
distinguishable from a default that has since changed.

Switching a module off removes its section from that subscriber's customer files, takes its
checks off their request screen, and refuses its products on the API with the refusal
`MODULE_OFF`. The section is also **not counted as required**, so a file is not held short of
complete for a service nobody sold them.

`credit_bundles` and `bundle_grants` are the second way to pay: prepaid operations with an
expiry, spent before the wallet. `tenant_price_discounts` is a blanket percentage for one
subscriber.

### Onboarding and actions

`onboarding_journeys`, `onboarding_journey_steps`, `onboarding_cases`, `onboarding_case_steps`,
`case_actions` and `case_action_log`. A case step may be waived, and a waiver must name both a
reason from a closed list and the person who waived it.

### Requests, sharing, awaiting, money in

| Table                                                | What it holds                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `verification_requests`, `verification_request_checks`| What somebody ticked on the console, with the subject sealed and the checks settled one at a time |
| `profile_shares`                                     | A time limited, group scoped link to a verified profile. `expires_at` is NOT NULL: a share with no expiry cannot be created |
| `run_waits`                                          | A step waiting for a provider callback, matched by `correlation_digest`                          |
| `topup_requests`, `topup_counters`                   | A bank transfer request and its one time confirmation. Excluded from every retention sweep: it is a financial record with a tax invoice |
| `api_requests`                                       | The API call log: route **pattern**, status, latency. Never a body and never a path value        |

### Provider routing per service

| Table                       | What it holds                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `product_provider_routing`  | For a verification service, an ordered list of providers, each `active` or `standby`. No tenant: this is the platform's choice for everybody |
| `provider_usage`            | Calls served per provider per service per month, with failures, cost and the last call. **No tenant, no subject, no identifier**: a platform operational figure |

`provider_usage` has **no foreign key to the catalogue**, deliberately: a provider that served a
call is a fact whether or not somebody has catalogued it, and a counter that can refuse a row is
a counter that can fail the verification it was only meant to count.

Two functions go with them:

- `app.resolve_service_providers(tenant, product, endpoint)` returns the candidates in order:
  a subscriber's BYOC or endpoint-scoped binding first, then the platform's routing for that
  service, then the subscriber's general binding. `SECURITY DEFINER`, because it reads the
  provider catalogue that the application role deliberately cannot read (rule 5), and it hands
  back only the names needed to place a call.
- `app.service_cost(product, provider)` returns what one run of that service would cost us under
  that provider, or NULL when that provider has no price for one of its steps.

### The risk model

The score a customer file shows, and everything it is made of (ADR-138, migration 0052).

| Table                  | What it holds                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `risk_signals`         | One row per signal: its Arabic name, its category, its severity, its weight, whether it is counted, and the one number its condition compares against with a label saying what that number means |
| `tenant_risk_signals`  | One subscriber's disagreement, field by field. Each NULL keeps inheriting the platform's answer for that one field, and a row that overrides nothing is deleted rather than kept |
| `tenant_risk_settings` | That subscriber's bands, or NULL to inherit the platform's                                       |

`platform_settings` gained `risk_high_from` (60) and `risk_medium_from` (30), with a check that
the medium band starts below the high one.

`risk_signals.product_code` names the verification service whose answers a signal reads. It has
**no foreign key**, for the same reason `provider_usage` has none: the catalogue is a seed, so a
migrated but unseeded database has no products and a risk model that cannot be written until
the catalogue exists is one that cannot ship with the schema.

Resolution is `resolveRiskPolicy(tx)` on the subscriber's own connection, so row level security
is what keeps one subscriber's opinions out of another's score. `DEFAULT_RISK_POLICY` in
`packages/core/src/customers/risk-policy.ts` carries the same numbers, so the pure assessment
stays callable from a test or a screen with no database.

A signal that is off is **not raised at all** rather than raised and weighed zero: what a reader
is shown and what the score is made of have to be the same list.

Two group controls write these rows rather than adding a flag of their own, so a score is still
explained from one place: `setProductRisk` reaches every signal that reads one verification
service, and `setCategoryRisk` every signal of one kind (`STATUS`, `MISMATCH`, `INTERSECTION`,
`INCOMPLETE`, `CHANGE`, `AGE`). Their per-subscriber twins write `tenant_risk_signals`, and
resuming a kind for a subscriber deletes their rows rather than writing «on» into them.

### The administration panel

`operator_accounts` holds named platform staff: role (`OWNER`, `PRICING`, `SUPPORT`,
`READ_ONLY`), a scrypt password, lockout counters, and since migration 0049 the second factor:
`credential_version` (a session issued under an older version is refused), a sealed
`totp_secret_enc` with its key version, `totp_confirmed_at`, `totp_last_step` and
`recovery_codes`. A check keeps the TOTP columns coherent: all null, or a secret with its key
version.

`platform_settings` is a single row of global verification behaviour: `max_attempts` (1 to 5),
`result_validity_days`, `name_match_threshold_pct`, `registry_alert_days`.
`section_requirements` says which file sections each customer kind needs and in what order. It
is the platform-wide layout; which of those sections one subscriber actually sees is decided by
their modules, and a section no check of theirs can fill is not drawn at all.

### The one view

#### `entity_profile`

```
WITH (security_invoker = true)
```

Mandatory, and the reason is worth remembering: without it the view would run as its owner and
read past every row level security policy.

> Latest live attestation per field, aged against the TTL in force now. Rule 5: source is absent
> by design.

Columns: `tenant_id`, `entity_id`, `field_path`, `value`, `authority`, `observed_at`,
`confidence`, `attestation_id`, `ttl_days`, `weight`, `effective_until`, `freshness`. Both
`source` and `valid_until` are deliberately absent.

TTL precedence, as rebuilt in migration 0047: a portfolio row, then a tenant row, then a system
default, longest `field_path` first, then shortest `ttl_days`, and
`platform_settings.result_validity_days` last of all.

---

## The five roles

Every role is `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT`. **No role bypasses row
level security**, and every tenant table is forced, so even the owner is subject to policy
(rule 12). Passwords are never in a migration: 0001 creates the roles without one and the runner
assigns them from the environment.

| Role           | Logs in | Owns                                          | Holds                                                                                                                                                        |
| -------------- | ------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nx_migrator`  | yes     | Schema `app`, every table, view, index, trigger | Runs every migration. One policy of its own, on the default price list                                                                                        |
| `nx_app`       | yes     | **nothing**                                    | Read and write on the tenant tables. `DELETE` on configuration tables only. Column level: `UPDATE (superseded_by)` on `attestations`, two columns on `tenant_commitments`. Insert only on `wallet_ledger`, `evidence`, `audit_log`, `api_requests` |
| `nx_retention` | yes     | nothing                                        | The **only** role with `DELETE ON attestations`, enforced twice: by grant and by trigger. Deletes identifiers, evidence, request logs, waits, shares, requests and inbound events; updates `entities.archived_at`; inserts audit. `SELECT` only on `topup_requests` |
| `nx_operator`  | yes     | nothing                                        | Configuration across tenants: providers, connections, endpoints, bindings, packages, prices, bundles, staff accounts, settings. Reads wallets, request logs, top-ups, margin counters. Can reach **no** run, attestation, identifier, entity or decision |
| `nx_auth`      | **no**  | Six `SECURITY DEFINER` functions in `app`       | Exists only to own the lookups that must happen before a tenant is known: an API key, a session, a login, an evidence token, an SSO domain, a share. Only `nx_app` may execute them |

---

## Row level security policies

The standard policy, named `t_isolation`, appears on every tenant-scoped table:

```sql
USING (tenant_id = app.current_tenant())
WITH CHECK (tenant_id = app.current_tenant())
```

Four variants exist, each for a reason:

| Shape                                                                      | Tables                                                                                | Why                                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `USING (id = app.current_tenant())`                                        | `tenants`                                                                             | The tenant is its own key                                                     |
| `USING (tenant_id IS NULL OR tenant_id = current)` with a stricter `CHECK` | `freshness_policy`, `change_severity_rules`, `decision_rulesets`, `price_book`          | Read the system defaults, write only your own                                  |
| Isolation through a parent                                                 | `decision_rules`                                                                       | It has no `tenant_id`; it reaches one through its ruleset                      |
| `TO nx_auth` read-only lookups                                             | `api_keys`, `users`, `user_sessions`, `user_credentials`, `tenants`, `tenant_idp`, `sso_domains`, `sso_login_requests`, `evidence`, `profile_shares` | The one class of lookup that cannot be tenant-scoped, because it is what establishes the tenant |
| `TO nx_operator`                                                           | `tenant_provider_binding`, `tenant_commitments`, `tenant_product_overrides`, `tenant_modules`, `tenant_risk_signals`, `tenant_risk_settings`, `tenant_price_discounts` (write); `tenants`, `wallets`, `api_requests`, `margin_counters`, `topup_requests`, `bundle_grants` (read) | Configuration and money, never verification data                              |

---

## Vocabularies

| Vocabulary               | Values                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Entity and subject types | `BUSINESS`, `PERSON`, `FREELANCER`, `BANK_ACCOUNT`, `PROPERTY`                                                     |
| Customer kinds           | `COMPANY`, `ESTABLISHMENT`, `FREELANCER`                                                                            |
| Identifier types         | `CR`, `UNN`, `NATIONAL_ID`, `IQAMA`, `FREELANCE_DOC`, `IBAN`, `REAL_ESTATE_NO`, `PARTY_ID`                          |
| Entity roles             | `SUBJECT`, `MANAGER`, `OWNER`, `ACCOUNT_HOLDER`, `PROPERTY_OWNER`, `PARTNER`, `ACCOUNT`, `LIQUIDATOR`, `GUARDIAN`, `MAIN_REGISTRY` |
| Relation types           | `MANAGES`, `OWNS`, `HOLDS_ACCOUNT`, `OWNS_PROPERTY`, `SHARES_ADDRESS`, `LIQUIDATES`, `REPRESENTS`, `BRANCH_OF`      |
| Decisions                | `PASS`, `FAIL`, `REVIEW`. A review case may only conclude `PASS` or `FAIL`                                          |
| Freshness                | `permanent`, `expired`, `expiring`, `fresh`. The warning window is the lesser of 14 days and a quarter of the TTL   |
| Run statuses             | `PENDING`, `AWAITING`, `OK`, `PARTIAL`, `NOT_FOUND`, `ERROR`                                                        |
| Step statuses            | `OK`, `NOT_FOUND`, `ERROR`, `SKIPPED`, `CACHED`, `AWAITING`, `PENDING`                                              |
| Triggered by             | `API`, `CONSOLE`, `MONITOR`, `BULK`                                                                                 |
| Charge source            | `PACKAGE`, `BUNDLE`, `WALLET`, `FREE`                                                                               |
| Provider mode            | `MANAGED`, `BYOC`                                                                                                   |
| Severity                 | `INFO`, `WARNING`, `CRITICAL`                                                                                       |
| Subscriber roles         | `VIEWER`, `ANALYST`, `APPROVER`, `ADMIN`                                                                            |
| Platform staff roles     | `OWNER`, `PRICING`, `SUPPORT`, `READ_ONLY`                                                                          |
| Audit actors             | `USER`, `API_KEY`, `SYSTEM`, `NX_STAFF`                                                                             |
| Ledger reasons           | `TOPUP`, `CHARGE`, `REFUND`, `EXPIRY`, `ADJUSTMENT`, `HOLD`, `RELEASE`                                              |
| Environments             | `sandbox`, `live`                                                                                                   |
| Provider adapter kinds   | `stub`, `http`, `openbanking`                                                                                       |
| Profile sections         | `REGISTRY`, `CONTRACT`, `MANAGERS`, `ADDRESS`, `BANKING`, `FREELANCE`, `PROPERTY`                                   |
| Monitor cadence          | `DAILY`, `WEEKLY`, `MONTHLY`, `ON_EXPIRY`                                                                           |
| Billing models           | `PAYG`, `MONTHLY`, `ANNUAL`, with terms of 3, 12 or 24 months                                                       |

### Structural checks worth knowing

- A `credential_ref` or `secret_ref` must start `kms://` and be at most 200 characters, on five
  different tables. That is rule 10 enforced by the database rather than by a code review.
- Every hash column is length checked: 32 bytes for SHA-256 and HMAC, 64 for scrypt, 16 for a
  salt.
- A VAT invoice id may only appear on a `TOPUP` ledger row.
- A confirmed top-up must carry both an invoice id and a settlement time.

### Custom error codes raised by triggers

| SQLSTATE | Raised when                                        |
| -------- | -------------------------------------------------- |
| `NX001`  | An attestation is updated in any way but superseding |
| `NX002`  | An attestation is deleted by anyone but retention    |
| `NX003`  | A price row is edited rather than closed             |
| `NX004`  | A wallet ledger row is updated or deleted            |
| `NX005`  | A review is decided or approved by the wrong role    |
| `NX006`  | A sandbox is created of a sandbox                    |
| `NX007`  | A key's environment does not match its workspace     |

---

## The 52 migrations

| #    | Name                                 | What it added                                                                                                             |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 0001 | `roles_and_schema`                   | The roles, all `NOBYPASSRLS`; schema `app`; `CREATE` revoked from PUBLIC on `public`                                        |
| 0002 | `foundation_tables`                  | `tenants`, `entities`, `attestations`, with composite tenant-carrying foreign keys                                          |
| 0003 | `rls`                                | `app.current_tenant()`, RLS enabled and forced, `t_isolation`, baseline grants                                              |
| 0004 | `attestations_immutability`          | The append-only triggers, and `DELETE` granted to `nx_retention` alone                                                      |
| 0005 | `entity_identifiers`                 | Identifiers as hash plus ciphertext, with the resolution index                                                              |
| 0006 | `entity_profile`                     | The profile as a `security_invoker` view                                                                                    |
| 0007 | `freshness_policy`                   | Time to live as rows, `app.freshness_state()`, and freshness computed rather than read                                      |
| 0008 | `tenant_provider_binding`            | Provider mode, credential reference and health per (tenant × provider)                                                      |
| 0009 | `products_and_runs`                  | The catalogue, runs, steps, the idempotency index and the not-billed checks                                                 |
| 0010 | `normalisation`                      | `step_field_map` and `entity_relations`                                                                                     |
| 0011 | `pricing_and_wallet`                 | Cost book, price book with its immutability trigger, wallets, append-only ledger                                            |
| 0012 | `api_keys_and_webhooks`              | `nx_auth`; API keys, webhook endpoints and deliveries; the partitioned audit log                                            |
| 0013 | `monitoring_and_evidence`            | Monitors, severity rules, change events, evidence, scores                                                                   |
| 0014 | `decision_rules`                     | Rulesets, rules and the seeded default set                                                                                  |
| 0015 | `review_queue`                       | The review queue with four eyes and decision completeness                                                                   |
| 0016 | `portfolios`                         | Portfolios, members, and the third level of every policy                                                                    |
| 0017 | `batches`                            | Batches and items, with the confirmed cost promise                                                                          |
| 0018 | `users_and_sessions`                 | Users and sessions; review actors became real foreign keys with a role trigger                                              |
| 0019 | `authentication`                     | Slugs, scrypt credentials, login attempts, and the pre-tenant login lookup                                                  |
| 0020 | `provider_routing`                   | `nx_operator`; the provider catalogue; priority and endpoint filtering; `app.resolve_providers()`                            |
| 0021 | `key_rotation`                       | `key_versions`, and the key version on identifiers and evidence                                                             |
| 0022 | `sso`                                | The subscriber's own directory: IdP config, domains, identities, login requests                                             |
| 0023 | `notifications`                      | Channels, rules and deliveries                                                                                              |
| 0024 | `packages`                           | Packages, their products, subscriptions, overrides and monthly usage                                                        |
| 0025 | `commitments`                        | Packages became term commitments; `tenant_subscriptions` became `tenant_commitments`                                        |
| 0026 | `plan_capacity`                      | Billing model, included transactions, overage and platform fee                                                              |
| 0027 | `sandbox`                            | `tenants.sandbox_of`, one per workspace and never nested                                                                    |
| 0028 | `run_reference`                      | A human readable run number, and the charge source                                                                          |
| 0029 | `onboarding`                         | Journeys, steps, cases and case steps                                                                                       |
| 0030 | `case_actions`                       | What a decided file sets off, and the log of what it fired                                                                  |
| 0031 | `margin_counters`                    | Aggregated margin the operator may read and never write                                                                     |
| 0032 | `key_environment`                    | The trigger that makes a key's environment follow its workspace                                                             |
| 0033 | `api_requests`                       | The request log: route patterns, never values                                                                               |
| 0034 | `operator_service_view`              | Operator read on wallets and request logs                                                                                   |
| 0035 | `provider_connections`               | Per-environment connections: kind, URLs, timeouts, credential reference                                                     |
| 0036 | `inbound_callbacks`                  | Callback slug, secret, header and algorithm; the tenant-less inbound events table                                           |
| 0037 | `awaiting_runs`                      | `AWAITING` as a status, the correlation digest, and `run_waits`                                                             |
| 0038 | `profile_shares`                     | A shared profile: hashed token, mandatory expiry, group scoping                                                             |
| 0039 | `topup_requests`                     | Money in by bank transfer, with a reference and a one time confirmation                                                     |
| 0040 | `operator_reads_products`            | Operator read on products, steps and the migration ledger                                                                   |
| 0041 | `retention_reaches_new_tables`       | Retention reaches inbound events. Top-ups deliberately excluded                                                             |
| 0042 | `notifications_seen`                 | `users.notifications_seen_at`, so the inbox is assembled rather than duplicated                                             |
| 0043 | `provider_endpoints`                 | A provider's endpoint map as rows: paths, envelopes, field maps, authorities                                                |
| 0044 | `connection_checks_and_operator_audit` | The result of the last connection test, and the platform staff trail                                                       |
| 0045 | `customer_checks`                    | Products became sections of a customer file; partner and account roles; ten TTLs and eight severity rules                    |
| 0046 | `verification_requests`              | What somebody ticked, sealed; its checks; subscriber preferences                                                            |
| 0047 | `admin_panel`                        | Staff accounts, platform settings, section requirements, credit bundles and grants, per-subscriber discounts                |
| 0048 | `complete_answers`                   | Liquidators, guardians and main registries; three new relations; `PARTY_ID`; five TTLs and a severity rule                   |
| 0049 | `operator_second_factor`             | `credential_version`, and the sealed authenticator secret with its recovery codes                                           |
| 0050 | `service_routing`                    | Which provider serves which verification service, what each would cost, a counter proving where the calls went, and a place in the file for the property section |
| 0051 | `modules`                            | `modules` and `tenant_modules`; `products.module_code`; the `INCOME` section, and income verification placed in it           |
| 0052 | `risk_policy`                        | `risk_signals`, `tenant_risk_signals`, `tenant_risk_settings`, and the two bands on `platform_settings`                       |

---

## Writing a migration

See [the migration guide](../guides/run-a-migration.md). In short: a numbered pair of `.up.sql`
and `.down.sql`, beginning with `SET LOCAL ROLE nx_migrator`, and
`pnpm run migrate:verify` must show that up, down and up again produce an identical schema.
