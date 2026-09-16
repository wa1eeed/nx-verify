# Guide: connect a data source

A source is connected **per environment**, and the credential never enters our database.

---

## The shape of it

| Row in                    | Says                                                            |
| ------------------------- | ---------------------------------------------------------------- |
| `provider_catalog`        | This source exists, and which endpoints it serves                |
| `provider_connections`    | Where it is, per environment, and which credential opens it      |
| `provider_endpoints`      | Its paths, envelopes and field names, as rows                    |
| `tenant_provider_binding` | Which subscriber it serves, in which mode, at what priority      |

Nothing in that list is code. Connecting a new source needs no release.

---

## 1. Connect it

From the panel: **الربط التقني** under إعدادات التحقق. Or from the command line, which is what a
deployment reviewed in a change request wants:

```bash
docker compose run --rm --no-deps api pnpm provision provider:connect \
  --provider registry --environment sandbox --kind http \
  --base-url https://sandbox.example.sa \
  --ref kms://providers/registry/sandbox
```

A source needing two hosts, such as open banking:

```bash
docker compose run --rm --no-deps api pnpm provision provider:connect \
  --provider bank --environment sandbox --kind openbanking \
  --base-url https://sandbox.example.sa \
  --auth-url https://auth.sandbox.example.sa/oauth2/token \
  --ref kms://providers/bank/sandbox
```

**`--ref` is a pointer, not a secret.** The column refuses anything that does not begin `kms://`
(rule 10). The secret itself never enters our database or its backups.

**A separate reference per environment.** Sharing one means rotating the test secret stops
production.

## 2. Put the secret in its store

| Deployment  | Where                                            | Can the panel write it |
| ----------- | ------------------------------------------------ | ---------------------- |
| Development | `NX_SECRETS`, as JSON                            | No, and it says so     |
| Production  | `NX_SECRETS_ENDPOINT` with its token, or the sealed file | Yes, and it is never shown again |

In production the panel writes the secret straight into the store. It is not displayed after
saving and it passes through no table of ours.

## 3. If the source calls back

Some sources answer later. Issue them an address:

```bash
docker compose run --rm --no-deps api pnpm provision provider:callback \
  --provider registry --environment sandbox \
  --ref kms://providers/registry/sandbox/webhook \
  --header x-registry-signature --algorithm sha512
```

It prints something like `https://api.<domain>/v1/callbacks/<opaque>`. Paste it into the source's
dashboard and put their signing secret in the store under the same reference, keyed
`webhookSecret`.

The address is opaque and names no provider, because a path that says who serves us is that name
published. The signature is over the raw bytes. The body is never stored, only its digest.

**Rotating the address invalidates the old one at once.** Do not press it unless the source's
dashboard is open in front of you.

## 4. Choosing which provider serves a service

This is the decision an owner makes when a provider raises its price, and it is made from the
panel rather than by editing a catalogue: **إعدادات التحقق → المزودون والخدمات**.

Each verification service has a row: who serves it now, our price, what it costs us under that
provider, and the margin. Underneath, every provider in the catalogue with what **it** would cost
and the margin it would give, so the comparison is on one screen.

| Control    | Does                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------- |
| يخدم       | This provider takes the calls, at the rank you give it                                    |
| احتياط     | Carried ready and tested, and not called. The answer to an outage and to a price rise alike |
| الترتيب    | Lower runs first. A `down` provider is skipped and the next takes over with no intervention |
| إزالة      | Takes the provider off this service entirely                                               |

### How to know the calls actually moved

Under the same service, a second table: **what actually happened this month and last, per
provider**. It is a counter written as each call is placed, not a setting, so it is evidence
rather than configuration. After a switch, the new provider's count starts rising within minutes
of the next verification and the old one stops.

A run also records the provider that served it, and the cost is attributed to that provider, so
the margin report follows the switch too.

### What the choice does not override

- **A subscriber who brought their own account (BYOC)** is never moved. Their binding is their
  contract and their credential.
- **A subscriber bound to a provider for named endpoints** keeps that, because listing endpoints
  is a deliberate statement about that subscriber.
- Everything else follows the panel.

Every change is written to the staff trail with the provider, the rank and where it moved from.
«Which provider served this verification» is a question that arrives a year later.

---

## 5. Bind a subscriber to it

The connection says where the source is. The binding says who is served by it and how:

```bash
docker compose run --rm --no-deps api pnpm provision provider:bind \
  --tenant <TENANT_ID> --provider registry --mode MANAGED \
  --ref kms://providers/registry/live
```

`MANAGED` means we call with our credential and charge the subscriber's balance. `BYOC` means we
call with theirs and there is no query cost to us. The mode is per (subscriber × source), not per
subscriber.

## 6. Check it

`/operator/verification/health` says whether the source answers. The worker tests every active
binding every five minutes, and routing skips one that is `down`.

`/operator/verification/readiness` says what is still missing before a launch, ordered by whether
it blocks one.

---

## What must stay true afterwards

1. No secret in any row. `credential_ref` starts `kms://` and the column refuses anything else.
2. No source named in any response a subscriber sees. The exposed field is `authority`.
3. A separate credential reference per environment.
4. A `nx_test_` key reaches the sandbox connection only, and a `nx_live_` key the live one.
