# Security model

What this platform is worth attacking for, who would, what stops them, and what is still open.

The controls are stated as facts elsewhere: [configuration](../reference/configuration.md),
[the database](../reference/database.md), [secrets](../05-secrets.md). This page is the
reasoning, and the honest list of what is not done.

---

## What is worth taking

| Asset                              | Why somebody wants it                                                    |
| ---------------------------------- | ------------------------------------------------------------------------ |
| Saudi national identity numbers, residence permits, freelance and party documents | Identity fraud, and a PDPL breach with a named regulator |
| Commercial registry and ownership data | Mostly public in pieces; valuable assembled, and it maps company control |
| IBANs and account ownership        | Payment redirection fraud                                                 |
| Verification decisions             | A forged `PASS` opens an account somewhere                                |
| The master key                     | Every identifier at once                                                  |
| Data source credentials            | Someone else's registry quota, spent as us                                |
| The administration panel           | Prices, every subscriber, and the ability to move balances                |

The last two are why the panel is treated as the most sensitive surface in the platform, not the
API.

---

## Who

| Actor                            | What they try                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------ |
| An opportunist on the internet   | Credential stuffing, a leaked key from a repository, an unauthenticated endpoint |
| A subscriber's own employee      | Reading more than their role allows, or taking data out on the way to a new job  |
| A subscriber, against another    | A crafted request that crosses tenants                                          |
| A person on our own staff        | Reading a customer's file, changing a price, moving a balance                   |
| A compromised dependency         | Anything, from inside our own process                                          |
| A compromised data source        | A hostile payload, or a callback claiming to be an answer                       |

---

## Data classes

| Class                       | Examples                                           | Rule                                                                 |
| --------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| **Identifiers**             | National identity, residence permit, CR, UNN, IBAN, freelance and party documents | HMAC for lookup, ciphertext for display, never plain text anywhere (rule 4) |
| **Verified facts**          | A company's status, a manager's powers, an address | Tenant-scoped, kept as attestations, destroyed on the retention clock |
| **Credentials**             | Data source secrets, webhook secrets               | A `kms://` reference in the database; the value in a sealed store (rule 10) |
| **Keys**                    | The master key                                     | A key service in production; the environment is refused there         |
| **Operational**             | Route patterns, statuses, latencies                | Logged. Never a body, never a path value                              |
| **Financial**               | Balances, invoices, top-ups                        | Excluded from retention: it is a tax record                           |

---

## The controls, against the twelve rules

| Rule                                    | How it is enforced                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1. Attestations are immutable           | Two triggers (`NX001`, `NX002`), a grant that gives `DELETE` to one role, and guard 01                 |
| 2. No query crosses tenants             | `withTenant` is the only path to the database; counters instead of cross-tenant reads; guard 02        |
| 3. RLS on every tenant table            | Enabled **and forced**, so the owner is not exempt                                                    |
| 4. No identifier in plain text          | HMAC plus AES-GCM, length-checked columns, a redaction list in the logger and the error handler, guard 05 |
| 5. No provider name in a public response | Checked on the way out of the API, kept out of the view by omitting `source`, enforced by guard 06 and a test over the OpenAPI document |
| 6. Every field has an authority and a time | `NOT NULL` columns, and a schema with no free text but one labelled exception                       |
| 7. Idempotency                          | The key is claimed before any provider call, behind a unique index; guard 03                          |
| 8. Products are rows                    | Three tables; adding one needs no release                                                             |
| 9. No optimisation before measurement   | One partitioned table, no cache, no projection                                                        |
| 10. No credential in the database       | `CHECK (... LIKE 'kms://%')` on five tables                                                           |
| 11. Real PostgreSQL in tests            | Testcontainers at the production version                                                              |
| 12. Application role is not the owner   | Four roles, none with `BYPASSRLS`, the application owning nothing                                     |

---

## At the door

**The API.** A bearer key of 32 random bytes, hashed with SHA-256 and resolved through a
`SECURITY DEFINER` function that returns only a tenant, scopes and an environment. A revoked key
answers exactly as an unknown one does. Sixteen scopes with no wildcard and no hierarchy. Rate
limiting per key rather than per address.

**The console.** A session cookie, scrypt passwords, lockout on repeated failure, and optionally
the subscriber's own identity provider over OIDC with PKCE, where the state and nonce are stored
as hashes and a login request is consumed once.

**The panel.** A password **and** a code from an authenticator, with no way to postpone the
second: a member of staff without one enrols at their first sign in and reaches no screen until
they have. The session carries the version of the account's credentials, so a password change, a
demotion, a disabling or a reset authenticator ends every other session at its next request. Ten
recovery codes, shown once, sealed like passwords. Every sign in, reset and recovery code use is
in the trail.

---

## In flight and at rest

Content security policy with a nonce minted per response, so the framework's own inline scripts
run and an injected one does not. `nosniff`, a referrer policy, frame denial, a permissions
policy, and HSTS in production. The API answers `default-src 'none'` and `no-store`.

Identifiers are sealed with a key derived per tenant from the master key: a hash for lookup, so a
subject can be resolved without decrypting anything, and ciphertext for display. Key versions
exist so rotation is a job rather than an outage, because the hash is a lookup index and changing
the key naively would unmatch every row.

Data source credentials live in a sealed file or a secret manager, and the database holds only a
reference. Back that up separately from the database and never beside the master key: either one
alone is useless, which is the point.

---

## What is logged, and what is not

A log line carries a route pattern, a status, a latency, a job name and a workspace. It never
carries a path value, a request body, an identifier or a provider's name. A mail transport
records the status of a failure and not the response body, so a service that echoes the recipient
cannot leak it into our logs.

The audit trail is partitioned monthly, tenant-scoped, and holds references, field names and
figures, never material. Retention writes its own audit row: destruction is auditable too.

---

## Supply chain

`pnpm audit --prod` and a secret scanner run in CI over the working tree **and the whole
history**, and either stops a merge. The scanner is written in the repository rather than pulled
from an action, because a scanner reads every line of this repository, including the ones not
meant to leave it.

Authentication code is written here for the same reason: the one time password implementation is
forty lines of RFC 6238 with the specification's own test vectors, and a dependency in the
authentication path is a risk that needs a justification.

---

## PDPL

| Obligation                       | Where it is met                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| Purpose limitation               | A verification runs against a product a subscriber bought; a monitor records who activated it and an optional consent reference |
| Data minimisation                | The public API and a shared link mask every identifier; the evidence check page carries no name or value at all |
| Storage limitation               | `tenants.retention_days`, default five years, enforced by a sweep that writes its own audit row |
| Accuracy                         | Every field carries its observation time and ages on its own                              |
| Security                         | The controls above                                                                        |
| Accountability                   | An audit trail per tenant, an operator trail for staff, and a decision that always carries its reasons |
| Rights of a data subject         | **Partly.** A file can be read and destroyed on request through retention, but there is no self-service export or erasure flow for a data subject |
| Breach notification              | **Not built.** A procedure exists on paper only                                           |

An independent PDPL review is `SEC-09` and has not happened.

---

## What is open

Stated plainly, because a security page that lists only strengths is marketing.

| Open                                                                 | Severity                                   |
| -------------------------------------------------------------------- | ------------------------------------------ |
| A webhook secret exposed in a conversation has not been rotated       | High. Inbound signatures are unproven until it is |
| No independent penetration test                                       | Required before a financial customer       |
| No PDPL compliance review                                             | Required before a financial customer       |
| Key rotation has code and tests but is not scheduled                  | The ninety day promise is manual today     |
| Type faces are fetched from a third party, so every user's browser contacts it | Privacy, and two extra origins in the policy |
| Styles allow `unsafe-inline`, because screens set spacing through the style attribute | Low, and it goes when those move to classes |
| No formal breach notification procedure                               | Needed for PDPL                            |

The first three need somebody outside this repository. The rest are ours, and are in
[the work ahead](../reference/scheduled-tasks.md).

---

## If something happens

Rotate first, investigate second. The order matters: a credential that has reached a chat, a
screenshot, a ticket or a commit is public, and deleting the message does not take it back.
[The incident guide](../guides/incident-response.md) is the procedure;
[the secrets guide](../05-secrets.md) has the commands.
