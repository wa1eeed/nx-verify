# Tutorial: from a clone to a verified customer

By the end of this you will have the whole platform running on your machine, a workspace with
credit in it, an API key, and a customer file on screen built from a verification that went
through the real domain layer.

About fifteen minutes, most of it waiting for a build.

This is a tutorial: follow it in order and do not substitute your own values yet. When you want
to change something, the guides and the reference are the places for that.

---

## What you need

- [Docker](https://docs.docker.com/get-docker/), running.
- Node 20.11 or newer, and pnpm 9. `corepack enable` gets you pnpm if you do not have it.
- About 2 GB of disk for the images.

You do **not** need an account with any data source. The platform ships with a stub provider
that answers exactly like a real one, which is why the whole product could be built before any
account existed.

---

## 1. Clone and install

```bash
git clone https://github.com/wa1eeed/nx-verify.git
cd nx-verify
pnpm install
```

## 2. Write the environment file

```bash
cp .env.example .env
chmod 600 .env
```

Open `.env` and set at least these. Generate every secret; do not invent one by hand.

```bash
openssl rand -base64 32    # run it once per secret below
```

| Variable                                                                    | What to put                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `NX_POSTGRES_PASSWORD`                                                      | A generated value                                             |
| `NX_MIGRATOR_PASSWORD`, `NX_APP_PASSWORD`, `NX_RETENTION_PASSWORD`, `NX_OPERATOR_PASSWORD` | A generated value each                                        |
| `NX_MASTER_KEY`                                                             | A generated value. This is the development path; production uses a key service |
| `NX_OPERATOR_TOKEN`                                                         | A generated value                                             |

The connection strings in the template already point at the compose database. Every other
variable can stay as it is for now; [the configuration reference](../reference/configuration.md)
explains each one.

Check the file before going on:

```bash
bash scripts/check-secrets-hygiene.sh
```

It reads names and lengths only. It prints no value.

## 3. Bring it up, with something in it

```bash
bash scripts/demo.sh
```

This takes a few minutes the first time. It brings up the database, runs the migrations, starts
the API, the console and the worker, provisions a workspace called `demo`, gives it a plan,
prices and 5,000 riyals of credit, issues an API key, and then runs four verifications so the
screens have real data on them.

Nothing is inserted into a table to make a screen look full: every row on those screens came
through the provider adapter, the normalisation layer, the pricing and the sealing, exactly as a
real verification does.

When it finishes it prints where to go and how to sign in. Keep that output.

### If it stops

| It says                              | What happened                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `no .env`                            | Step 2 was skipped                                                                |
| `the API never became ready`         | Look at `docker compose logs api`. Usually a connection string or a missing key    |
| `no tenant was created`              | The migrations did not finish. `docker compose logs migrate`                       |
| A product answered `402`             | The workspace has no credit. The demo tops it up, so this means provisioning broke |

## 4. Sign in to the console

Open <http://localhost:3001>. Sign in with the address and the temporary password the script
printed.

The console will make you change the password before it shows you a single screen. That is by
design: the person who created the account never knows the password it ends up with.

You are now looking at the subscriber's world:

- **الرئيسية** is the home: what was verified, what needs attention, this month's usage.
- **العملاء** is the list of customers. Open one.
- Inside a customer file, each section says where its facts came from, when they were observed,
  and whether anything has changed since.

## 5. Read a customer file

Open any customer from العملاء. What you are looking at is not a record somebody typed: it is a
projection. For every field, the platform holds the newest valid attestation, each stamped with
the authority that said it and the moment it was observed. Nothing here was ever edited, because
`attestations` accepts no UPDATE and no DELETE (rule 1).

Notice:

- Each section carries its own timestamp and source.
- A field that has aged past its time to live is marked, neutrally. A field that has **changed**
  is marked in amber, and that is a different thing.
- Identifiers are shown in full, because the subscriber owns this customer relationship. In the
  public API and in a profile shared by link they are masked.

## 6. Run a verification of your own

Take the API key the script printed, and run one:

```bash
curl -sS -X POST http://localhost:3000/v1/verifications \
  -H "authorization: Bearer $NX_API_KEY" \
  -H 'content-type: application/json' \
  -H 'idempotency-key: my-first-one' \
  -d '{
    "product": "KYB_COMPLETE",
    "subject": { "unn": "7001272190", "manager": { "id": "1098765440", "id_type": "NATIONAL_ID" } },
    "display_name": "شركة التجربة",
    "reference": "TUTORIAL"
  }' | jq
```

Read the answer. Three things in it are worth noticing:

- `decision` is ours, not the source's: `PASS`, `REVIEW` or `FAIL`, with its reasons.
- `authority` names the official body. The provider's name is nowhere in the response and never
  will be (rule 5).
- No identifier you sent comes back in plain text.

Now send exactly the same request again, with the same `idempotency-key`. You get the same
answer, and the workspace is charged once (rule 7). Change the key and it runs again, and is
charged again.

Refresh العملاء in the console: your new customer is there.

## 7. Look at the administration panel

Open <http://localhost:3001/operator>. This is the platform's own panel, not the subscriber's:
prices, subscribers, balances, the connection to the data source.

The first time, it asks for the deployment token (`NX_OPERATOR_TOKEN`) and makes the first owner
account. After that the token opens nothing here.

You will then be asked to enrol an authenticator, and you cannot reach a single screen until you
do. Scan the code, enter the six digits, and **keep the ten recovery codes**: they are shown once
and cannot be recovered.

Inside, notice that this panel has its own database role, its own connection and its own sign in.
That is not tidiness: it is the only way to be certain a subscriber's session can never reach a
screen that names a provider.

## 8. Stop it

```bash
docker compose down            # keeps the data
docker compose down -v         # throws the data away too
```

---

## What to read next

- [Set up a development machine](../guides/development-environment.md), to work on the code
  rather than run it.
- [The architecture](../explanation/architecture.md), for what just happened underneath.
- [The API reference](../reference/api.md), for everything the call in step 6 can do.
- [Add a verification product](../guides/add-a-verification-product.md), to see rule 8 in
  practice: a new product is rows, not a release.
