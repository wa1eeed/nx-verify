# Guide: deploy to production

In order, with what blocks a launch marked. Do not start here: a production deployment follows a
sandbox that has answered at least one call correctly.

The platform is **not deployed twice**. There is one deployment, and the two worlds are rows: a
connection per environment, a sandbox workspace linked to its parent, and a key prefix that
decides which one a call reaches.

---

## Before anything

| Blocking | What                                                                                     |
| -------- | ----------------------------------------------------------------------------------------- |
| Yes      | A key service endpoint. Production refuses to start on an environment key, by design       |
| Yes      | A secret manager or a protected volume for the sealed store                                |
| Yes      | Working data source credentials for the live environment                                   |
| Yes      | `NX_OPERATOR_TOKEN` of 32 random bytes                                                     |
| Yes      | TLS in front of both ports, and a domain for each                                          |
| Strongly | An independent penetration test and a PDPL review                                          |
| Strongly | A backup destination, separate from the machine, and a restore that has been rehearsed     |

## 1. The environment

```bash
cp .env.example .env
chmod 600 .env
```

Generate every secret. Nothing here is typed by hand:

```bash
openssl rand -base64 32
```

What must differ from a developer's machine:

| Variable                                        | Why                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| `NX_KMS_ENDPOINT`, `NX_KMS_TOKEN`, `NX_KMS_KEYS` | The master key comes from a key service. The environment path is refused    |
| `NX_SECRETS_ENDPOINT` or `NX_SECRETS_FILE`      | The panel writes credentials into a store, not a column                     |
| `NX_OPERATOR_TOKEN`                             | 43 characters or more, and the platform enforces it                         |
| `NX_RETENTION_DATABASE_URL`                     | Without it nothing is ever destroyed, and only a startup line says so       |
| `NX_CONSOLE_BASE_URL`, `NX_PUBLIC_BASE_URL`     | Shared links and evidence checks are built from them                        |
| `NODE_ENV=production`                           | Turns on HSTS and secure cookies, and turns off every development shortcut  |

Then check the machine:

```bash
bash scripts/check-secrets-hygiene.sh
```

## 2. Bring it up

```bash
docker compose up -d db
docker compose run --rm migrate
docker compose up -d api console worker
```

`migrate` runs as the owner role; the services run as roles that own nothing and bypass no policy
(rule 12).

Confirm the worker said what you want to hear:

```bash
docker compose logs worker | head -5
```

A line naming `NX_RETENTION_DATABASE_URL` means nothing will ever be destroyed.

## 3. Seed and connect

```bash
docker compose run --rm --no-deps api pnpm provision products:seed
```

Then connect the live source and put its secret in the store:
[connect a data source](connect-a-data-source.md).

## 4. The first owner of the panel

Open `/operator/login`. It asks once for `NX_OPERATOR_TOKEN` and makes the first owner account.
After that the token opens nothing there.

That person then enrols an authenticator before they reach a single screen, and **keeps the ten
recovery codes**: they are shown once and cannot be recovered. Everyone else is added by an owner
from «الصلاحيات والتدقيق».

## 5. The first subscriber

From the panel, or from the command line:

```bash
docker compose run --rm --no-deps api pnpm provision tenant:create \
  --name "شركة العميل" --slug acme --admin-email admin@acme.sa
docker compose run --rm --no-deps api pnpm provision package:assign --tenant <id> --package ESSENTIAL
docker compose run --rm --no-deps api pnpm provision sandbox:create --tenant <id>
docker compose run --rm --no-deps api pnpm provision price:set --tenant <id> --product KYB_COMPLETE --amount 44.00
docker compose run --rm --no-deps api pnpm provision wallet:topup --tenant <id> --amount 5000 --invoice INV-2026-001
docker compose run --rm --no-deps api pnpm provision key:issue --tenant <id> --name integration
```

Every secret prints once.

## 6. Prove it, including what must not work

```bash
curl -X POST https://api.<domain>/v1/verifications \
  -H "authorization: Bearer nx_live_…" -H "content-type: application/json" \
  -H "idempotency-key: $(uuidgen)" \
  -H "X-NX-Test-Scenario: not_found" \
  -d '{"product":"ADDRESS_ONLY","subject":{"unn":"<a real number>"}}'
```

The scenario header is there deliberately and **must be ignored**. If the answer is `NOT_FOUND`,
either the key is not a live key or the environment is wrong. Stop the launch.

Then:

- `/operator/verification/health`: does the source answer.
- `/operator/pricing`: every product's cost, price and margin, with any price under cost refused.
- `/operator/verification/readiness`: what is still missing, blocking items first.

## 7. Watch the first day

| Check                              | Where                                        |
| ---------------------------------- | -------------------------------------------- |
| The worker is sweeping             | `docker compose ps` shows it healthy          |
| Nothing is queuing unsent          | The panel's delivery screens                 |
| Refusals are the expected kind     | `/operator` overview, and the request log     |
| The balance moves as expected      | The subscriber's wallet and ledger            |

---

## What must stay true

1. No secret in any row. `credential_ref` starts `kms://` and the column refuses anything else.
2. No data source named in any response a subscriber sees.
3. No identifier in plain text in any column, log, error or backup.
4. A `nx_test_` key never reaches production, and a `nx_live_` key ignores the scenario header.
5. Every POST honours `Idempotency-Key`.
6. `docker compose down -v` destroys the volume. Never run it on a deployment with data.

---

## Deploying to a server with Coolify

The platform is three processes and a database: the console, the API and the worker, all from
this repository, all reading the same variables.

### The variables Coolify holds

Keep this list short on purpose. **One secret belongs in the deployment; the rest belong in the
panel**, because a key pasted into a deployment tool is a key in a second place that has to be
rotated when somebody leaves.

| Variable | Why it must be here |
| --- | --- |
| `NX_DATABASE_URL`, `NX_OPERATOR_DATABASE_URL`, `NX_RETENTION_DATABASE_URL`, `NX_ADMIN_DATABASE_URL` | Nothing can read anything without them |
| `NX_MASTER_KEY` (or `NX_MASTER_KEY_SOURCE`) | Every sealed thing is sealed under it, including the secret store itself |
| `NX_SECRETS_FILE` | Where that store lives on the volume. With it, every other key is set from the panel |
| `NX_OPERATOR_TOKEN` | 32 random bytes. Without it there is no way into the panel at all |
| `NX_OPERATOR_EMAIL`, `NX_OPERATOR_PASSWORD` | The first owner, made true at every start (ADR-142) |
| `NX_CONSOLE_URL`, `NX_CONSOLE_BASE_URL` | What a link in an email points at |

**Mount a volume for `NX_SECRETS_FILE`.** It holds every provider credential and the mail key,
sealed. A container that loses it loses them, and every one has to be entered again.

### What is not here, and why

The data source's client id and secret, its mTLS material, and the mail service's key are all
set from the panel: «إعدادات التحقق ← الربط التقني» and «إعدادات التحقق ← البريد». They are
written to the sealed store and the database keeps only a `kms://` pointer (rule 10). That is
why the list above is short.

### The owner, and the one thing to know about it

`NX_OPERATOR_PASSWORD` **wins over the panel**. Change it in Coolify, redeploy, and that is the
password; every session opened under the old one stops working. A password changed inside the
panel is overwritten at the next start, so change it in Coolify or not at all.

It never touches the second factor. The owner enrols an authenticator once and it survives every
redeployment, which is the point: a bootstrap that cleared it would turn two steps into one on
every deploy and nobody would notice.

### The order of a first deployment

1. Set the variables above and deploy. The worker creates the owner and says so in its log
   (the outcome only, never the address or the password).
2. Sign in at `/operator/login`, enrol an authenticator, and **save the ten recovery codes**.
   They are shown once.
3. «إعدادات التحقق ← البريد»: choose the service, set the address it sends from, paste the key
   once, and press «أرسل رسالة تجربة». A message that arrived is the proof; a form that saved
   is not.
4. «إعدادات التحقق ← الربط التقني»: the data source's credentials, the same way.
5. «جاهزية النشر» goes green when everything a first verification needs is in place.

