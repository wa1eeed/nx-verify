# Scheduled tasks

Everything the worker runs on its own: what, how often, as which database role, and what happens
when it fails. Then the work that is planned next, with its priorities.

The worker is the process that destroys data on time, delivers callbacks, watches for changes and
finishes requests. None of that announces itself, which is why it has a heartbeat and why this
page exists.

---

## The jobs

| Job                     | Every       | Scope   | Role         | Does                                                          |
| ----------------------- | ----------- | ------- | ------------ | ------------------------------------------------------------- |
| `resume`                | 30 seconds  | tenant  | app          | Expires overdue waits, matches callbacks to runs, resumes them |
| `webhooks`              | 30 seconds  | tenant  | app          | Delivers up to 50 queued webhooks                              |
| `verification-requests` | 30 seconds  | tenant  | app          | Picks up requests left behind and settles their checks         |
| `notifications`         | 1 minute    | tenant  | app          | Delivers up to 50 messages. **Only registered when `NX_MAIL_ENDPOINT` is set** |
| `batches`               | 1 minute    | tenant  | app          | Runs up to 20 batch items                                      |
| `provider-health`       | 5 minutes   | tenant  | app          | Tests each active binding and writes its health                |
| `monitors`              | 15 minutes  | tenant  | app          | Runs up to 25 due monitors within their budgets                |
| `retention`             | 6 hours     | tenant  | **retention** | Destroys what is past its period, and prunes the request log  |
| `inbound-events`        | 24 hours    | global  | **retention** | Deletes callbacks older than 90 days                          |
| `audit-partitions`      | 24 hours    | global  | app          | Creates the audit partition for this month and two ahead       |

Everything is due at startup, so a deployment does not wait an interval for its first sweep.

---

## How the loop works

**Due time is measured from completion, not from start.** A job that takes longer than its
interval runs back to back and never overlaps itself.

**A job never runs twice at once.** The guard is keyed on the job's name, so the whole per-tenant
fan-out counts as one slot: the same job for tenant B does not start while tenant A's is still
running. That guards one process. Two worker processes would each run their own loop, which is
safe only because every claim is `FOR UPDATE SKIP LOCKED` at the row level.

**A failure is recorded and skipped, never fatal.** One subscriber's bad row must not stop the
sweep for everybody else. The log carries the job name and the workspace, never the row that
failed (rule 4).

**One transaction per (job, tenant).** A job that throws halfway loses all of its work for that
tenant in that sweep, including rows written for earlier items. That matters most for `monitors`,
which has no per-item catch, and for `retention`, which is all or nothing including its own audit
row.

**A global job still runs inside a tenant transaction**, because there is no other kind of
connection, and it is given the first active workspace. With no active workspace, a global job
does nothing and its due time still advances.

**The tick is 5 seconds**, and stopping waits for the run in flight rather than killing a
delivery halfway.

### The heartbeat

After **every** sweep, whatever the sweep did, the worker touches the file named by
`NX_WORKER_HEARTBEAT`. Nothing is written into it: the fact is the modification time.

```bash
pnpm --filter @nx-verify/worker run health
```

Exits 0 while the last sweep is under 90 seconds old and 1 once it is not. The container's health
check runs it every 30 seconds with three retries and a minute of grace at startup.

It beats even when nothing was due, because a quiet worker looks exactly like a dead one, and the
worker has died silently before: an unreferenced timer once let the process exit with a zero
after its first sweep, and every job stopped without a word.

---

## Retention, in detail

Three sweeps with three separate governing periods.

### `retention`, every 6 hours, per tenant, as the retention role

| What                                                     | When it goes                                                     | Cap per sweep |
| -------------------------------------------------------- | ---------------------------------------------------------------- | ------------- |
| Superseded attestations                                  | Older than `tenants.retention_days` (default 1825 days, 5 years) | 5,000         |
| Identifiers of an entity with no recent knowledge, and the entity is archived | The same window                                | 5,000         |
| Resolved run waits                                       | 30 days                                                          | none          |
| Revoked or expired profile shares                        | 180 days                                                         | none          |
| Finished or cancelled verification requests              | 30 days; a draft after 90                                        | none          |
| API request log                                          | 30 days                                                          | none          |

A **live** attestation is never edited or tombstoned (rule 1). Destruction lands on the
identifiers, and the entity is archived instead: what remains says that something was known,
without saying about whom.

The sweep writes its own audit row, `retention.enforced`, with the counts. Destruction is
auditable like everything else.

`topup_requests` is deliberately excluded: it is a financial record with a tax invoice, and the
retention role holds only `SELECT` on it.

### `inbound-events`, every 24 hours, global

Deletes callbacks older than 90 days by age alone, since the table has no tenant. A wait expires
within a day, so a delivery still unmatched after three months will never match.

### If retention is not configured

`NX_RETENTION_DATABASE_URL` is optional, and without it the `retention` and `inbound-events` jobs
never run. The worker says so once, loudly, at startup:

```
NX_RETENTION_DATABASE_URL is not set, so retention will not run and nothing will be destroyed
```

Check for that line after every deployment. The platform's promise that a customer's data is
destroyed after the agreed period has failed silently once before, when the job was wired to a
role that may not delete.

---

## Monitoring

A monitor is due when `next_run_at` has passed and it is still `active`. Up to 25 per tenant per
sweep, oldest first, claimed with `SKIP LOCKED`.

**Budget first, always.** If what remains this period is less than the worst case charge, the
monitor is pushed to its cap, its status becomes `budget_exhausted`, and a `wallet.low` event is
queued. It stops rather than overspending, and somebody is told.

The period rolls over with the calendar month. The cadence arithmetic is plain: daily adds a day,
weekly seven, monthly a month, and `ON_EXPIRY` re-examines daily.

A sweep produces a run like any other, plus one `entity.changed` event per detected change and a
refreshed score.

> **Freshness alerts are not scheduled.** A field passing its time to live is computed when a
> screen asks, and the console's alerts page is what surfaces it. The `attestation.expired`
> event type exists and nothing emits it.

---

## Delivery

Webhooks and notifications share one retry ladder: after the immediate attempt, **2 minutes, 10
minutes, 1 hour, 6 hours, 24 hours**, then abandoned. Six attempts over about 31 hours. An
abandoned delivery stays readable in the console.

Notifications are never sent to an unverified address: the claim joins the channel and requires
`verified_at`. A failing mail endpoint is recorded by status only, never by its response body, so
a service that echoes the recipient cannot leak it into a log.

With no `NX_MAIL_ENDPOINT` the notifications job does not exist at all and messages queue with no
sender. Unlike retention, nothing warns about this.

---

## Verification requests

Every 30 seconds, per tenant, and cheap when there is nothing to do: an `EXISTS` check runs before
any registry is built.

| Rule                  | Value                                                                       |
| --------------------- | --------------------------------------------------------------------------- |
| Grace before pick-up  | 30 seconds. A younger request belongs to the console runner that started it  |
| Per sweep             | 10 requests                                                                  |
| Expiry                | 24 hours, after which open checks fail with a written note and are not billed |
| Lock staleness        | 600 seconds before another runner may take a `RUNNING` check                 |
| Retry delay           | 10 seconds between attempts of one check                                     |
| Attempts              | `platform_settings.max_attempts`, default 2, between 1 and 5                 |

Checks settle **one at a time, in order**, each in its own transaction, so a balance running out
on the fourth check leaves the first three recorded. A failure to reach the source is one failed
attempt with an Arabic note, retried, and never billed.

The subject is decrypted under the request's own key version, for the call and nothing else.

---

## Provider health

Every five minutes, per tenant, each active binding.

| Outcome                             | Written                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| Not registered in this deployment   | **Nothing.** Marking it down would be a claim with no basis    |
| Answered                            | `healthy`, `degraded` or `down`, with latency                  |
| Threw, or the credential is unusable | `down`                                                        |

Routing skips a `down` binding and falls to the next; `degraded` does not skip. A change of status
writes an audit row, `provider.health_changed`, with where it moved from and to.

---

## Everything that is a number

| Knob                            | Value        | Configurable       |
| ------------------------------- | ------------ | ------------------ |
| Scheduler tick                  | 5 seconds    | no                 |
| Heartbeat staleness             | 90 seconds   | no                 |
| Panel registry cache            | 60 seconds   | no                 |
| Monitors per sweep              | 25           | no                 |
| Batch items per sweep           | 20           | no                 |
| Webhook deliveries per sweep    | 50           | no                 |
| Notifications per sweep         | 50           | no                 |
| Waits matched per sweep         | 50           | no                 |
| Retention rows per sweep        | 5,000        | no                 |
| Audit partitions ahead          | 2 months     | no                 |
| Inbound event age               | 90 days      | no                 |
| Request log age                 | 30 days      | no                 |
| Requests per sweep              | 10           | no                 |
| Request grace                   | 30 seconds   | no                 |
| Request expiry                  | 24 hours     | no                 |
| Wait time to live               | 24 hours     | no                 |
| Delivery retry ladder           | 2m, 10m, 1h, 6h, 24h | no         |
| Webhook signature tolerance     | 5 minutes    | no                 |
| Attempts per check              | 2            | **yes**, in the panel |
| Retention window                | 1825 days    | **yes**, per tenant   |

---

## Known gaps

Recorded here rather than left to be discovered.

1. **Key rotation is not scheduled.** `rotateIdentifierKeys` exists, is tested, and rewrites
   rows from an older key version to the current one in batches of 500. Nothing calls it: it has
   no entry in the job table. The ninety day rotation the blueprint promises is therefore a
   manual operation today. See [rotating keys](../05-secrets.md).
2. **`attestation.expired` has no producer.** The event type exists and has a notification
   template; nothing queues it.
3. **Notifications disappear silently without a mail endpoint**, unlike retention, which warns.

---

## The work ahead

What is planned, in order. Kept here so that a schedule of work and a schedule of jobs live in
one place, and neither is a surprise.

### Before a first paying customer

| Priority | Item                                          | Why it blocks                                                                 |
| -------- | --------------------------------------------- | ----------------------------------------------------------------------------- |
| 1        | Rotate the exposed webhook secret (`SEC-08`)   | A secret that appeared in a conversation is public. Inbound signatures are unproven until it is rotated |
| 2        | Connect a key service (`NX_KMS_ENDPOINT`)      | Production refuses to start without one, by design                             |
| 3        | Working data source credentials, both worlds   | The supplied client secret is a truncated copy of the application id           |
| 4        | Independent penetration test and a PDPL review (`SEC-09`) | An outside opinion, before a financial customer                     |
| 5        | Real source costs, then a price and bundle review | Today's figures are provisional, and guard 10 refuses a price under cost     |

### Soon after

| Priority | Item                                                                                      |
| -------- | ----------------------------------------------------------------------------------------- |
| 6        | Schedule key rotation, so the ninety day promise is kept by the platform and not by a person |
| 7        | Self host the type faces, which removes two external origins from the content policy and ends every user's browser contacting a third party |
| 8        | Fix the concurrent queries on one pooled client that `pg` warns about, before `pg@9` turns the warning into an error |
| 9        | Property verification, once the source enables it                                          |
| 10       | Measure the customer and subscriber lists at 50,000 rows, and only then decide whether anything needs an index or a projection (rule 9) |

### Waiting on somebody else

A sandbox account with the data source, the partnership request and the contract draft under NDA,
a legal opinion on the service credit structure, a mail delivery endpoint, and a card payment
gateway. None of these is a line of code; all of them are in
[progress.md](../progress.md) under «ما تبقى».
