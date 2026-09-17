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
| Yes      | A root key. A key service (`NX_KMS_ENDPOINT`) where there is one, or a file on a protected volume (`NX_MASTER_KEY_FILE`). Production refuses an environment **variable** either way, by design (ADR-151) |
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

The platform is three processes and a database, all from this repository and all reading the
same variables: `api`, `console`, `worker`, `db`. `docker-compose.yml` describes the four and a
one-shot `migrate` that runs before them.

### 0. What the server needs

A VPS with Coolify installed, 2 vCPU and 4 GB of memory as a floor, and about 10 GB free. The
build compiles the console, which is the heaviest step; a 2 GB machine will run out of memory
during it.

Two subdomains pointed at the server's address, because the console and the API are separate
and a browser must reach one without reaching the other:

```
app.example.sa   → the console, where people sign in
api.example.sa   → the public API, where integrations call
```

### 1. Make the resource

In Coolify: **Project → New Resource → Docker Compose**, source *Public Repository* (or your
private repository with a deploy key), repository `https://github.com/wa1eeed/nx-verify`, branch
`main`, and **Docker Compose Location** `/docker-compose.yml`.

Coolify reads the file and lists five services. Do not deploy yet.

### 2. The variables

Run this on your own machine, with your two domains and the address you will sign in with:

```bash
./scripts/coolify-env.sh app.example.sa api.example.sa you@example.sa
```

It generates every password and the token with `openssl`, builds the four connection strings
so the passwords in them match, and prints your panel sign in separately at the end. Nothing
is invented in a document that somebody later copies: the values exist only where you paste
them.

In Coolify: **Environment Variables → Developer view**, and paste the output.

Four things about that list.

**The host is `db`, not `localhost`.** The four connection strings reach the database service by
its name inside the stack.

**`NX_OPERATOR_PASSWORD` is a database role**, not your sign in. Your sign in is
`NX_PANEL_OWNER_PASSWORD`. They were one variable once and that was a mistake: a password typed
into a browser must never also be a connection credential.

**The panel owner variables win over the panel.** Change `NX_PANEL_OWNER_PASSWORD` here and
redeploy and that is the password; one changed inside the panel is written over at the next
start, and every session opened under the old one ends. The authenticator is never touched, so
two steps survive a redeployment.

**A token shorter than 32 random bytes is refused** (SEC-06). There is no way into the panel
without it.

### 3. The domains

Domains belong to a **service inside the resource**, not to the project, and the field only
appears for a service Coolify knows publishes a port. The compose file declares that outright,
with `SERVICE_FQDN_CONSOLE_3000` and `SERVICE_FQDN_API_3000`, so the fields are there on a
first load rather than after a deploy.

Coolify → the resource → **Domains**, per service. **Include the container port**, which is
3000 for both:

| Service | Domain |
| --- | --- |
| `console` | `https://example.sa:3000` |
| `api` | `https://api.example.sa:3000` |

The console and the landing page are one application, so the console's domain is the address a
visitor, a subscriber and a member of staff all arrive at.

Leave `db`, `migrate` and `worker` with no domain. The worker answers no port on purpose: the
one process holding the role that may delete should not also hold a listening socket.

Coolify issues the certificates. Nothing in this platform terminates TLS itself.

### 4. Deploy

Press **Deploy**. The first build takes several minutes: one image, used by all three
processes, so what runs in production is byte for byte what was tested.

Watch the `migrate` logs. On a first deployment they say:

```
{"level":"warn","message":"a new root key was made on this deployment"}
{"level":"warn","message":"back up the volume holding it, separately from ..."}
0001 applied  ...
```

Then `api`, `console` and `worker` start. `migrate` exits 0 and stays exited: that is what it is
for, and Coolify showing it as stopped is correct.

### 5. Back up the key, before anything real

The stack keeps three volumes and **they must not be backed up to the same place**:

| Volume | Holds | If you lose it |
| --- | --- | --- |
| `db` | Every attestation, entity and ledger row | Everything, unless restored |
| `secrets` | Provider credentials and the mail key, sealed | Re-enter them in the panel |
| `keys` | The root key everything above is sealed under | **Every sealed credential and every stored identifier becomes unreadable, and no backup of the other two brings them back** |

`keys` together with `secrets` is the plaintext of every credential. `keys` together with `db`
is every identifier this platform holds. That is why they are three volumes and not one, and
why the guidance is to hold them in three places.

Where you have a key service, set `NX_KMS_ENDPOINT`, `NX_KMS_TOKEN` and `NX_KMS_KEYS` instead;
the key file is then ignored and the root key never reaches the machine at all. That is better,
and «جاهزية النشر» says so.

### 6. The first sign in

1. Open `https://app.example.sa/operator/login` and sign in with `NX_PANEL_OWNER_EMAIL` and
   `NX_PANEL_OWNER_PASSWORD`.
2. Enrol an authenticator and **save the ten recovery codes**. They are shown once.
3. «إعدادات التحقق ← البريد»: choose the service, set the address it sends from, paste the key
   once, then press «أرسل رسالة تجربة». A message that arrived is the proof; a form that saved
   is not.
4. «إعدادات التحقق ← الربط التقني»: the data source's credentials, the same way.
5. «جاهزية النشر» goes green when everything a first verification needs is in place.

### What is *not* in the variables, and why

The data source's client id and secret, its mTLS material, and the mail service's key are all
set from the panel. They go to the sealed store and the database keeps a `kms://` pointer
(rule 10). Keep the list above short on purpose: a key pasted into a deployment tool is a key in
a second place, which has to be rotated when somebody leaves.

### When something is wrong

| What you see | What it is |
| --- | --- |
| `NX_KMS_ENDPOINT or NX_MASTER_KEY_FILE is required in production` | The `keys` volume is not mounted on that service |
| The stack builds and `migrate` fails on connect | A connection string still says `localhost`; it must say `db` |
| `console` starts, sign in refuses everything | `NX_PANEL_OWNER_*` unset, so no owner was made. Set them and redeploy |
| Panel reachable, «جاهزية النشر» red on «تسليم البريد» | Mail is configured in the panel, not here. Expected until step 6.3 |
| `worker` marked unhealthy after a minute | It reports on a heartbeat file. Check its logs for a job throwing on every sweep |

### Updating

Push to `main` and press **Redeploy**. Migrations run first, in their own container, before any
process serves. A migration that fails stops the deployment with the old one still running,
which is the behaviour you want.
