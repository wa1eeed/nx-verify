# Guide: when something is wrong

First moves, in order, for the things that actually happen. The order is deliberate: in most of
these, acting before diagnosing is correct.

---

## A credential has leaked

A key in a commit, a secret in a chat message, a password in a screenshot, a token in a ticket.

**Rotate first. Investigate second.** A credential that has reached any of those places is
public, and deleting the message does not take it back. Removing it from a later commit does not
either: the blob stays in the history of every clone.

1. Generate a new value: `openssl rand -base64 32`.
2. Put it in place. [The secrets guide](../05-secrets.md) has the procedure per secret.
3. Confirm the old one no longer works.
4. Write down what leaked, when, and what was done. A regulator asking about a disclosure is
   asking for exactly that.
5. Only now, find out how it got there, and close that path.

| Leaked                     | Effect of rotating                                              |
| -------------------------- | ---------------------------------------------------------------- |
| `NX_OPERATOR_TOKEN`        | Every panel session ends at once. Staff sign in again            |
| A subscriber's API key     | That key alone stops working. Issue a new one and revoke the old |
| A data source credential   | Their calls fail until the new value is in the store             |
| A webhook signing secret   | Inbound signatures fail until both sides have the new one        |
| The master key             | Not a rotation but a migration: add a version, run the job, retire the old one. Never replace it in place |

---

## A subscriber says a verification is wrong

1. Ask for the `request_id` from the error, or the `reference` (`VRF-2026-000019`).
2. `/operator` → subscribers → their request log. It has the route, the status, the latency and
   our error code, and never a value.
3. Read the run in the console: which step failed, and what the source answered.
4. Check `/operator/verification/health`. A `down` binding explains a whole class of failure at
   once.

A run that failed is not billed. If a subscriber was charged for one, that is a defect and the
ledger will show it: the wallet ledger is append-only, so the movement is there to be read.

---

## The worker has stopped

The symptom is quiet: nothing is destroyed, nothing is delivered, requests sit at «قيد المعالجة».

```bash
docker compose ps                    # is it healthy
docker compose logs worker | tail -50
pnpm --filter @nx-verify/worker run health
```

The health check reads the age of the heartbeat file. Over 90 seconds means the loop has stopped,
and the container will restart it.

If it starts and stops again, read the first lines of the log: a missing connection string or an
unreadable key is refused at startup, loudly, on purpose.

**If it was down for a while**, nothing was lost: every job is due at startup and claims are per
row, so the first sweeps catch up. Watch the delivery queues drain rather than intervening.

---

## Nothing is being destroyed

```bash
docker compose logs worker | grep RETENTION_DATABASE_URL
```

That line means the retention role was never configured, and the sweep has never run. Set
`NX_RETENTION_DATABASE_URL`, restart the worker, and check the audit trail for a
`retention.enforced` row afterwards.

This has happened before, in a different form: the job was wired to a role that may not delete,
the database refused it on every sweep, and the scheduler swallowed the error exactly as it is
designed to. Nothing said so for weeks.

---

## The API is refusing everything

```bash
curl -s https://api.<domain>/ready | jq
```

| Answer                         | Means                                                      |
| ------------------------------ | ------------------------------------------------------------ |
| `checks.database: false`       | It cannot reach the database. Restarting will not help        |
| `checks.keys: false`           | The key service is unreachable. Everything sealed is stalled  |
| 503 with both true             | It is starting                                                |
| No answer at all               | The process is down, or TLS in front of it is                 |

`/ready` returns 503 deliberately when it cannot serve, so a load balancer stops sending traffic
rather than sending it into a wall.

---

## A data source is down

Routing already handles it: the health job marks the binding `down` within five minutes and
routing skips it for the next candidate. A product's own declared provider is tried last.

What to do:

1. Confirm at `/operator/verification/health`.
2. If there is a second source for that endpoint, nothing else is needed.
3. If there is not, say so to the subscribers who will ask. Runs that failed are not billed, and
   a run waiting on a callback is abandoned after 24 hours, also unbilled.

---

## Somebody has lost their authenticator

An owner opens «الصلاحيات والتدقيق», edits that member, and ticks the reset. Their sessions end
with it, and they enrol again at their next sign in.

If they have a recovery code, they can sign in with it themselves: each works once, and using one
is written into the trail with how many are left.

If the **last owner** is locked out and nobody else has the `staff` permission, the way back is
the deployment's token: with no account able to act, the first-owner path at `/operator/login` is
the recovery. That is why the token is worth rotating on staff departure.

---

## A tenant can see another tenant's data

Stop. This is the one that is not a support ticket.

1. Take the platform out of service. A leak that continues is a leak that grows.
2. Preserve the logs and the audit trail before anything is restarted.
3. Find the query. It is a query that reached the database outside `withTenant`, or a policy
   missing `WITH CHECK`, or a role that should not have a grant.
4. Add the guard case that would have caught it, and watch it fail on the old code before fixing
   it.
5. Notify. This is a personal data breach with a named regulator.

Guard 02 exists to make this impossible, and row level security is forced so that even the owner
role is subject to it. If it has happened anyway, something is wrong at a level below the
application.
