# API reference

Every endpoint, scope, error code and event of the public and operational API.

The machine readable specification is served by the deployment itself at
`GET /openapi.json`, and a test compares it against the routes the server actually registers, so
the two cannot drift. This page is the same information for a person, with the reasoning.

Base URL: whatever `NX_PUBLIC_BASE_URL` says. Port 3000 by default.

---

## Conventions

**Money crosses the boundary in riyals**, never halalas, and the currency is always `SAR`.
Prices are stored without VAT and VAT is calculated at display.

**Every error looks the same:**

```json
{
  "error": {
    "code": "NX-4031",
    "message_ar": "الصلاحية غير كافية",
    "message_en": "Insufficient scope",
    "retryable": false,
    "request_id": "req_a1b2c3d4e5"
  }
}
```

A failing response also carries `x-nx-error-code`. Send the `request_id` with any support
question: it finds the call in seconds.

**Every response** carries `x-content-type-options: nosniff`, `referrer-policy: no-referrer`,
`x-frame-options: DENY`, `cache-control: no-store` and a content policy of `default-src 'none'`.
In production it also carries HSTS. Nothing is cached, because every answer carries a customer's
verification.

**The body limit is 256 KiB.** A URL never carries an identifier (rule 4), so the subject travels
in the body.

**No response names a provider** (rule 5). The field you get is `authority`, the official body.

---

## Authentication

```
Authorization: Bearer nx_live_…
```

| Prefix      | World                                                     |
| ----------- | --------------------------------------------------------- |
| `nx_live_`  | A live workspace, reaching the official sources            |
| `nx_test_`  | A sandbox workspace, answered from published test data     |

A key is 32 random bytes in base64url. The stored prefix is its first 12 characters, which is
what the console shows and what is safe to quote to support. The full secret exists exactly once,
in the response that created it, and cannot be recovered.

The key is hashed with SHA-256 (deliberately not a slow hash: it is 256 bits of our own
randomness, not a human's password) and looked up through a `SECURITY DEFINER` function owned by
a login-less role. **A revoked key is indistinguishable from an unknown one**: both answer 401
`NX-4011`.

The environment comes from the workspace, never from the caller, and a database trigger refuses a
key whose environment does not match its workspace (`NX007`). That is why a test key cannot reach
production data and a live key ignores `X-NX-Test-Scenario`.

---

## Endpoints

### Infrastructure

| Method | Path             | Scope | Answers                                                            |
| ------ | ---------------- | ----- | ------------------------------------------------------------------ |
| GET    | `/health`        | none  | `{ status: "ok" }`. Liveness only: it checks nothing else on purpose |
| GET    | `/ready`         | none  | `{ status, checks: { database, keys } }`, and 503 when it cannot serve |
| GET    | `/openapi.json`  | none  | This API's specification                                            |

`/ready` is readiness and not liveness: an instance that cannot reach the database must not be
sent traffic, and restarting it would not help.

### Discovery and reading

| Method | Path                | Scope            | Answers                                                                        |
| ------ | ------------------- | ---------------- | ------------------------------------------------------------------------------ |
| GET    | `/v1/products`      | `products:read`  | The catalogue, each product with its JSON Schema and this workspace's price     |
| GET    | `/v1/entities/{id}` | `entities:read`  | The live profile: every field with its authority, observation time and freshness |
| GET    | `/v1/wallet`        | `wallet:read`    | `{ balance, held, available, currency, is_low }`                                |

The input schema travels with the product, so a client generates its own form and needs no change
when a product is added (rule 8).

### Verifications

#### `POST /v1/verifications`, scope `verifications:write`

```json
{
  "product": "KYB_COMPLETE",
  "subject": { "unn": "7001272184", "manager": { "id": "…", "id_type": "NATIONAL_ID" } },
  "reference": "your-own-reference",
  "display_name": "شركة العميل",
  "identifiers": [{ "type": "UNN", "value": "7001272184", "primary": true }]
}
```

`product` and `subject` are required. `subject` is validated against the product's own stored
schema. `identifiers` is optional: without it the platform reads `subject.unn`,
`subject.cr_number`, `subject.iban` and `subject.identifier`. If it finds nothing, the answer is
400 `NX-4001`.

The response:

```json
{
  "environment": "live",
  "verification_id": "…",
  "reference": "VRF-2026-000019",
  "product": "KYB_COMPLETE",
  "status": "OK",
  "decision": "PASS",
  "decision_reasons": [{ "code": "REQUIREMENTS_MET", "message_ar": "…", "message_en": "…" }],
  "entity_id": "…",
  "results": { "cr": { "status": "OK" }, "address": { "status": "NOT_FOUND" } },
  "billing": { "amount": 44.0, "currency": "SAR" },
  "evidence_url": "/v1/evidence/…",
  "replayed": false
}
```

| Status  | Meaning                                                                             |
| ------- | ----------------------------------------------------------------------------------- |
| **201** | Ran and finished                                                                    |
| **202** | `status` is `AWAITING`: the source will answer later, and a webhook will say so      |
| **200** | Replayed under the same `Idempotency-Key`                                            |
| 400     | `NX-4001`: the envelope is wrong, or no identifier could be found                    |
| 403     | `NX-4031`: scope, product not available, or the package does not include it          |
| 404     | `NX-4041`: unknown or retired product                                                |
| 409     | `NX-4091`: that identifier already belongs to another entity                         |
| 422     | `NX-4002`: the subject does not match the product's schema, or the balance is short  |
| 503     | `NX-5002`: the key service is unreachable                                            |

202 rather than 201 is deliberate: a 201 would tell the caller their verification is complete
when it is not.

#### The rest

| Method | Path                               | Scope                | Answers                                                     |
| ------ | ---------------------------------- | -------------------- | ----------------------------------------------------------- |
| GET    | `/v1/verifications/{id}`           | `verifications:read` | A stored run                                                |
| GET    | `/v1/verifications/{id}/document`  | `verifications:read` | The sealed Arabic HTML document, served and never regenerated |
| GET    | `/v1/evidence/{token}`             | **none**             | A public seal check: content hash and sealing time, no personal data |

The document is served rather than generated on request, because a document that can be
regenerated can be regenerated differently, which is the one thing a sealed record must not
allow.

### Review queue

| Method | Path                              | Scope            | Body                                    |
| ------ | --------------------------------- | ---------------- | --------------------------------------- |
| GET    | `/v1/review-cases`                | `review:read`    | `?status=` optional, limit 100          |
| POST   | `/v1/review-cases/{id}/assign`    | `review:write`   | `{ actor }`                             |
| POST   | `/v1/review-cases/{id}/decide`    | `review:write`   | `{ outcome, actor, note }`              |
| POST   | `/v1/review-cases/{id}/approve`   | `review:approve` | `{ actor }`                             |
| POST   | `/v1/review-cases/{id}/return`    | `review:approve` | `{ actor, reason }`                     |

`note` is required on a decision, and it is the one free text field in the platform (rule 6). The
approver may not be the decider: the API refuses it and so does the database.

### Portfolios, batches, monitoring, reports

| Method | Path                            | Scope               | Notes                                                         |
| ------ | ------------------------------- | ------------------- | ------------------------------------------------------------- |
| GET    | `/v1/portfolios`                | `portfolios:read`   | With policy and health                                        |
| POST   | `/v1/portfolios`                | `portfolios:write`  | 201                                                           |
| POST   | `/v1/portfolios/{id}/members`   | `portfolios:write`  | 201 when added, 200 when already a member                     |
| POST   | `/v1/batches/preview`           | `batches:write`     | Writes nothing. A preview is a question                       |
| POST   | `/v1/batches`                   | `batches:write`     | 201, as a draft                                               |
| POST   | `/v1/batches/{id}/confirm`      | `batches:write`     | `accepted_cost` must equal the estimate, or 422               |
| POST   | `/v1/batches/{id}/cancel`       | `batches:write`     |                                                               |
| GET    | `/v1/batches/{id}`              | `batches:read`      | Progress and cost                                             |
| POST   | `/v1/monitors`                  | `monitors:write`    | A budget is required and never defaulted                      |
| GET    | `/v1/dashboard`                 | `reports:read`      | Portfolio health at a glance                                  |
| GET    | `/v1/reports/monthly`           | `reports:read`      | `?month=YYYY-MM`                                              |

Confirming a batch against a figure that has moved is refused rather than run at the new number:
the promise is the number that was shown.

### Onboarding

| Method | Path                                    | Scope               | Notes                                                    |
| ------ | --------------------------------------- | ------------------- | -------------------------------------------------------- |
| GET    | `/v1/onboarding/journeys`               | `onboarding:read`   | Journeys are rows, so a new one appears at once           |
| POST   | `/v1/onboarding/cases`                  | `onboarding:write`  | Opens a file **and runs every check it needs**, 201       |
| GET    | `/v1/onboarding/cases`                  | `onboarding:read`   | Limit 100                                                 |
| GET    | `/v1/onboarding/cases/{id}`             | `onboarding:read`   |                                                           |
| POST   | `/v1/onboarding/cases/{id}/advance`     | `onboarding:write`  | The applicant's details are sent again, never stored      |
| POST   | `/v1/onboarding/cases/{id}/waive`       | `onboarding:write`  | The reason comes from a closed set                        |

One call rather than two, because a customer onboarding a merchant wants an answer and not a
handle.

---

## Scopes

Sixteen, with no wildcard and no hierarchy: membership is exact.

| Scope                 | Endpoints                                                                  |
| --------------------- | -------------------------------------------------------------------------- |
| `products:read`       | `GET /v1/products`                                                          |
| `entities:read`       | `GET /v1/entities/{id}`                                                     |
| `wallet:read`         | `GET /v1/wallet`                                                            |
| `verifications:write` | `POST /v1/verifications`                                                    |
| `verifications:read`  | `GET /v1/verifications/{id}`, `…/document`                                  |
| `onboarding:read`     | The three onboarding reads                                                  |
| `onboarding:write`    | Open a case, advance it, waive a step                                       |
| `review:read`         | `GET /v1/review-cases`                                                      |
| `review:write`        | Assign, decide                                                              |
| `review:approve`      | Approve, return                                                             |
| `portfolios:read`     | `GET /v1/portfolios`                                                        |
| `portfolios:write`    | Create, add a member                                                        |
| `batches:read`        | `GET /v1/batches/{id}`                                                      |
| `batches:write`       | Preview, create, confirm, cancel                                            |
| `monitors:write`      | `POST /v1/monitors`                                                         |
| `reports:read`        | `GET /v1/dashboard`, `GET /v1/reports/monthly`                              |

**What a new key gets by default** depends on who issues it, which is worth knowing:

| Issued by                | Scopes                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| The console              | `verifications:write/read`, `onboarding:write/read`, `products:read`, `entities:read`, `wallet:read`     |
| `pnpm provision key:issue` | Those seven plus `portfolios:read`, `batches:read`, `reports:read`, `review:read`                        |
| The library's own default | `verifications:write` alone                                                                              |

None of them grants `review:write`, `review:approve`, `portfolios:write`, `batches:write` or
`monitors:write`. Widening a key is a conversation, which is the right amount of friction.

---

## Idempotency

One endpoint reads the header: `POST /v1/verifications` reads `Idempotency-Key`. Onboarding
derives its own keys per step, and the console derives them from a bundle key, so neither is
caller supplied.

**How a replay is detected.** The key is *claimed first*: a `PENDING` run is inserted inside a
savepoint before any provider is called, and a unique index on `(tenant_id, idempotency_key)`
makes the duplicate lose the race at the index. Checking first and inserting later would let two
concurrent requests both see nothing, both call the provider, and both charge.

**A replay answers 200** with `replayed: true`, the same `verification_id`, `reference`,
`status`, `decision`, `decision_reasons` and results, and the billing figure recomputed from the
stored steps. It performs no validation, no hold, no provider call, no settlement, no quota use
and no webhook: same key, same result, one charge.

One caveat worth knowing: **a replay carries `evidence_url: null`**. The document is sealed once,
on the original run. Fetch it from `GET /v1/verifications/{id}/document`.

Uniqueness is per workspace, not per product, so reusing a key with a different subject returns
the first run rather than running the new one.

---

## Error codes

Nine, and that is the whole list.

| Code       | HTTP | Retryable | Means                                                                                                         |
| ---------- | ---- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `NX-4001`  | 400  | no        | The envelope is invalid, or the subject carries no identifier and none was supplied                            |
| `NX-4002`  | 422  | no        | The subject does not match the product's schema. Also: insufficient balance, a batch confirmed at a moved figure, a case in the wrong state |
| `NX-4011`  | 401  | no        | No bearer, an unknown key, **or a revoked one**. Also an unsigned or wrongly signed inbound callback            |
| `NX-4029`  | 429  | **yes**   | Rate limited                                                                                                   |
| `NX-4031`  | 403  | no        | The key lacks the scope, the product is not available, the package does not include it, or a role may not decide or approve |
| `NX-4041`  | 404  | no        | Unknown verification, entity, batch, case, token, product or journey                                           |
| `NX-4091`  | 409  | no        | The identifier already belongs to another entity; a step that can no longer be waived                          |
| `NX-5001`  | 500  | no        | Our fault. The detail is logged, never returned                                                                |
| `NX-5002`  | 503  | **yes**   | The key service is unreachable                                                                                 |

Only `NX-4029` and `NX-5002` are retryable, and the flag says so on every response rather than
leaving the caller to guess from the status.

---

## Rate limiting

120 requests per minute, keyed on the **last 16 characters of the `Authorization` header**, or on
the IP address when there is none. Per key rather than per address, so several customers behind
one gateway do not consume each other's allowance.

Exceeding it returns 429 `NX-4029` with `retryable: true`, plus the standard `x-ratelimit-*` and
`retry-after` headers. The limit is a build option rather than an environment variable; tests
lower it.

---

## Inbound callbacks

Some sources do not answer the call. They update on their own schedule and then call us.

`POST /v1/callbacks/{slug}` is the only route with no API key, and the signature is the
authentication. Three things about it are deliberate:

- **The address is opaque and names no provider.** A path that says who serves us is that name
  published (rule 5). The slug is 24 random bytes, issued by
  `pnpm provision provider:callback`, and stable once a provider has it in their dashboard.
- **The signature is over the raw bytes.** The body is parsed as a Buffer, because a signature
  over a re-serialised object is a signature over a different document. HMAC-SHA256 or SHA-512
  per connection, compared in constant time.
- **The body is never stored.** What is kept is the event type, its id and a digest of the bytes.
  A provider's payload carries account numbers and names, and rule 4 does not stop applying
  because somebody else sent them.

| Situation                          | Answer                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Unknown or inactive slug           | 404 `NX-4041`, the same answer an unknown path gives, so it is no oracle |
| No signature                       | 401 `NX-4011`                                                           |
| Wrong signature                    | 401 `NX-4011`                                                           |
| Our secret is not configured       | 500 `NX-5001`, deliberately distinct, so an operator does not spend the outage in the provider's dashboard |
| Anything else, first or repeated   | **202** `{ received: true, duplicate: boolean }`                        |

A retry is answered exactly as the first delivery was, because a provider told anything else will
retry, and a retry of an event we already hold must not become a second piece of work.

Nothing happens synchronously. The worker matches deliveries to waiting runs inside each tenant's
own scope, and a run whose source never answers is abandoned after 24 hours, unbilled.

---

## Outbound webhooks

An endpoint is HTTPS only, and its signing secret is a `kms://` reference, never a value.

| Event                    | Payload                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `verification.completed` | `verification_id`, `product`, `status`, `decision`, `entity_id`, `client_ref`, `triggered_by` |
| `verification.awaiting`  | `verification_id`, `product`, `entity_id`, `client_ref`                               |
| `entity.changed`         | `entity_id`, `field_path`, `severity`, `change_event_id`, `verification_id`           |
| `wallet.low`             | `monitor_id`, `entity_id`, `reason`                                                   |
| `onboarding.approved`    | `case_reference`, `journey`, `status`, `outcome`, `entity_id`, `client_ref`, `decided_at` |
| `onboarding.rejected`    | The same shape                                                                        |
| `onboarding.review`      | The same shape                                                                        |
| `attestation.expired`    | **Declared, and nothing emits it yet.** Freshness alerts are read from the console    |

The onboarding payload carries the file, never the applicant: no identifier, no provider, no
field values. A webhook lands in a system we do not control, exactly as an email does.

**The envelope:**

```json
{ "id": "<delivery id>", "type": "<event>", "created_at": "<ISO 8601>", "data": { } }
```

**The signature**, in header `nx-signature`:

```
t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">
```

The timestamp is inside the signed string, so a captured delivery cannot be replayed for ever.
Verify within five minutes of `t`.

**Retries**, after the immediate first attempt: 2 minutes, 10 minutes, 1 hour, 6 hours, 24 hours.
Six attempts over about 31 hours, then the delivery is `abandoned` and stays readable in the
console. The HTTP status is not consulted: a 4xx retries on the same ladder as a timeout.

Deliveries are written in the **same transaction as the change that caused them**, so an event is
never announced for something that rolled back.

---

## Which provider answered

Nothing in any response says. The field a caller gets is `authority`, the official body, and the
provider behind it is an operational detail that changes with contracts and prices (rule 5).

Which provider actually served a call is recorded on the run and counted per service, and both
are visible only in the administration panel. See
[the routing guide](../guides/connect-a-data-source.md#choosing-which-provider-serves-a-service).

---

## Test scenarios

A sandbox key may force a specific answer instead of hunting for an input that produces it:

```
X-NX-Test-Scenario: expired_cr
```

A live key ignores this header completely. If it did not, a caller could choose their own result,
and every result the platform gives would mean nothing.
