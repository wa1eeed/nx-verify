# NX Trust

A multi-tenant verification, onboarding and trust platform for the Saudi market.

NX Trust pulls facts about a business or a person from official registries, keeps each one as a
timestamped attestation that is never edited, and builds living entity files out of them, with
evidence, decisions and monitoring on top.

The platform is in Arabic and right to left throughout. This documentation is in English,
because the people who run a deployment are not always the people who built it.

---

## What it is

Five modules over one architecture.

| Module      | What it does                                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verify**  | Commercial registration, articles of association, a manager's powers, the national address, a freelance permit, an IBAN, a bank account, name matching, income, title deeds |
| **Onboard** | Onboarding journeys as rows, and a file per applicant with a deadline, waivers and a decision                                                                               |
| **Decide**  | The subscriber's own rules, simulated before they are switched on, and a confidence score with its reasons                                                                  |
| **Monitor** | Continuous watching, times to live, change detection and re-verification                                                                                                    |
| **Act**     | Actions bound to the outcome of a file: call the subscriber's systems, alert their team                                                                                     |

The data source is an implementation detail. Its name appears in no public response, and it is
changed from the administration panel without touching a single subscriber's integration.

## Who it is for

- **A subscriber**: a bank, a financing company, a marketplace or a payments provider that has
  to know who it is dealing with, and has to be able to prove later that it knew.
- **The platform's own staff**: the people who set prices, connect the data source, watch
  balances and answer the phone, working from an administration panel that no subscriber
  session can reach.

---

## Run it in fifteen minutes

You need [Docker](https://docs.docker.com/get-docker/), Node 20.11 or newer, and pnpm 9.

```bash
git clone https://github.com/wa1eeed/nx-verify.git
cd nx-verify
pnpm install
cp .env.example .env    # then fill it in: see docs/reference/configuration.md
chmod 600 .env
```

The fastest way to see the whole thing working, with real data that came through the domain
layer rather than inserted into tables:

```bash
bash scripts/demo.sh
```

It brings up every process, provisions a workspace, runs a handful of verifications, and prints
where to go and how to sign in. The API is on port 3000 and the console on 3001.

To prove a deployment actually works rather than to look at it:

```bash
bash scripts/smoke.sh
```

Full instructions, including what to do when a step fails, are in
[docs/tutorials/first-verification.md](docs/tutorials/first-verification.md).

---

## Working on it

```bash
pnpm run test              # every test, on real PostgreSQL through Testcontainers
pnpm run guards            # the ten architecture guards on their own
pnpm run migrate:verify    # up, down and up again, comparing the schema
pnpm run lint && pnpm run typecheck && pnpm run style
pnpm run security          # dependency audit and the secret scanner
```

The tests need Docker running: they use real PostgreSQL 16, never SQLite and never a mock of
the database layer, because row level security is a PostgreSQL feature and proving isolation
anywhere else proves nothing (rule 11).

```bash
pnpm --filter @nx-verify/api run dev       # the API
pnpm --filter @nx-verify/console run dev   # the console
pnpm --filter @nx-verify/worker run start  # the worker
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, the style rules and what a pull
request must carry.

---

## Where the code is

```
apps/api            the public and operational API, authentication, webhooks, OpenAPI
apps/console        the console and the administration panel (Next.js, RTL)
apps/worker         monitoring, batches, delivery, retention, partitions, key rotation
apps/mcp            an MCP server: a client of the public API, never of the database
packages/core       the domain: attestations, identity, freshness, products, normalisation,
                    pricing, decisions, review, portfolios, evidence, reports
packages/db         the schema, 49 migrations, the four roles, row level security, seeds
packages/providers  the VerificationProvider interface and its implementations
```

---

## The documentation

Organised the way [Diátaxis](https://diataxis.fr) suggests: a tutorial teaches, a guide solves a
task, a reference states facts, and an explanation gives the reasoning. Start at
[docs/README.md](docs/README.md) for the full map.

| I want to…                                | Read                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| Run the platform and verify something     | [tutorials/first-verification.md](docs/tutorials/first-verification.md)        |
| Set up a development machine              | [guides/development-environment.md](docs/guides/development-environment.md)    |
| Deploy to production                      | [guides/deploy-production.md](docs/guides/deploy-production.md)                |
| Know what an environment variable does    | [reference/configuration.md](docs/reference/configuration.md)                  |
| Know what a table or a column is          | [reference/database.md](docs/reference/database.md)                            |
| Call the API                              | [reference/api.md](docs/reference/api.md)                                      |
| Know what the worker runs and when        | [reference/scheduled-tasks.md](docs/reference/scheduled-tasks.md)              |
| Understand the architecture               | [explanation/architecture.md](docs/explanation/architecture.md)                |
| Understand the security model             | [explanation/security-model.md](docs/explanation/security-model.md)            |
| Handle a secret, or a leaked one          | [05-secrets.md](docs/05-secrets.md)                                            |
| Know what changed and when                | [CHANGELOG.md](CHANGELOG.md)                                                   |
| Know why something was built this way     | [decisions.md](docs/decisions.md)                                              |
| Know what is built and what is left       | [progress.md](docs/progress.md)                                                |

The rules that may not be broken are in [CLAUDE.md](CLAUDE.md), and they outrank every document
here. `docs/01-blueprint.md`, `docs/02-schema.md`, `docs/03-products.md`, `docs/decisions.md` and
`docs/progress.md` are the project's working record and are written in Arabic; everything under
`docs/tutorials`, `docs/guides`, `docs/reference` and `docs/explanation` is in English.

---

## Status

The platform is built and deployable. As of 2026-09-16: 1093 tests, ten architecture guards,
49 migrations that run up and down, and 134 recorded architecture decisions.

What is not built, and why, is in the «ما تبقى» section of [docs/progress.md](docs/progress.md).
The short version: production needs a key service endpoint, a data source account with working
credentials, and an independent security review. None of those is a line of code.
