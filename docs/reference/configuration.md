# Configuration reference

Every environment variable the platform reads: what it does, which process reads it, whether it
is required, what it defaults to, whether it is a secret, and where in the code it is read.

Service names below mean: **api** (`apps/api`), **console** (`apps/console`, which includes the
administration panel), **worker** (`apps/worker`), **mcp** (`apps/mcp`), **scripts**
(`scripts/`, `packages/db/scripts`), **tests** (`*/test`, `verify/*.mjs`), **compose**
(`docker-compose.yml`).

Some variables are read through a shared factory rather than in the process itself:
`masterKeySourceFromEnv` ([packages/core/src/crypto/kms.ts:210](../../packages/core/src/crypto/kms.ts)),
`secretStoreFromEnv` ([packages/providers/src/credentials.ts:377](../../packages/providers/src/credentials.ts))
and `providerConfigFromEnv` ([packages/providers/src/factory.ts:107](../../packages/providers/src/factory.ts)).
Every process that builds a context reads those transitively. The tables name the real read
site.

Anything marked **secret** belongs in `.env` at mode 600 or in a secret manager, and never in a
commit, a log, a ticket or a chat message. See [../05-secrets.md](../05-secrets.md).

---

## Database and roles

Rule 12: the owner role and the application role are different roles, and the application role
has no `BYPASSRLS` and owns nothing.

| Name                        | Read by                              | What it does                                                                                        | Required                                                              | Secret |
| --------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| `NX_ADMIN_DATABASE_URL`     | scripts                              | The owner connection, used to run migrations and provision roles. The application never uses it.     | Required by `migrate` (unless `--container`) and by `provision`        | Yes    |
| `NX_APP_DATABASE_URL`       | api, console, worker, scripts, tests | The runtime connection for the application role.                                                     | Required. The API throws without it                                    | Yes    |
| `NX_OPERATOR_DATABASE_URL`  | console, worker, scripts, tests      | The panel's own connection, and the one the worker uses to list workspaces and nothing else.         | Required for the panel and the worker                                  | Yes    |
| `NX_RETENTION_DATABASE_URL` | worker                               | The only role permitted to delete. Drives the retention sweep.                                       | Optional. Unset logs a warning at startup and retention never runs     | Yes    |
| `NX_MIGRATOR_PASSWORD`      | scripts                              | Assigned to the `nx_migrator` role after `migrate up`.                                               | Optional. Skipped when empty                                           | Yes    |
| `NX_APP_PASSWORD`           | scripts                              | Assigned to the `nx_app` role after `migrate up`.                                                    | Optional. Skipped when empty                                           | Yes    |
| `NX_RETENTION_PASSWORD`     | scripts                              | Assigned to the `nx_retention` role after `migrate up`.                                              | Optional. Skipped when empty                                           | Yes    |
| `NX_OPERATOR_PASSWORD`      | scripts                              | Assigned to the `nx_operator` role after `migrate up`.                                               | Optional. Skipped when empty                                           | Yes    |
| `NX_POSTGRES_PASSWORD`      | compose                              | The superuser password of the `postgres:16` container. No application code reads it.                 | Required by compose, which refuses to start without it                 | Yes    |

> **Retention is the one to check after a deploy.** It is optional in the sense that the worker
> starts without it, and a deployment where it is missing quietly never destroys anything. The
> startup log says so; nothing else will.

---

## Keys and secrets

| Name                  | Read by                              | What it does                                                                                                                  | Required                                                             | Secret       |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------ |
| `NX_MASTER_KEY`       | api, console, worker, scripts, tests | A base64 root key of 32 bytes, version 1, from which every per-tenant HMAC, encryption and signing key is derived.              | One of this, `NX_MASTER_KEYS` or `NX_KMS_ENDPOINT`. Refused in production | Yes          |
| `NX_MASTER_KEYS`      | api, console, worker, scripts        | Several versioned root keys, `1:<b64>,2:<b64>`. The highest is written with; every listed version stays readable.               | Optional. Wins over `NX_MASTER_KEY`                                   | Yes          |
| `NX_KMS_ENDPOINT`     | api, console, worker, scripts        | The key service. Its presence takes the root key off the environment path entirely.                                            | **Required when `NODE_ENV=production`**                               | No (address) |
| `NX_KMS_TOKEN`        | api, console, worker, scripts        | Bearer token for the key service.                                                                                              | Required whenever `NX_KMS_ENDPOINT` is set                            | Yes          |
| `NX_KMS_KEYS`         | api, console, worker, scripts        | The encrypted data key per readable version, `1:<ciphertext>,2:<ciphertext>`.                                                   | Required whenever `NX_KMS_ENDPOINT` is set                            | Yes          |
| `NX_SECRETS`          | api, console, worker, scripts        | A JSON map of key service reference to credential material. The development secret store.                                      | Optional. Layered over the sealed file when both are set              | Yes          |
| `NX_SECRETS_ENDPOINT` | api, console, worker, scripts        | A secret manager. Its presence selects it over every other store.                                                              | One of this or `NX_SECRETS_FILE` in production                        | No (address) |
| `NX_SECRETS_TOKEN`    | api, console, worker, scripts        | Bearer token for the secret manager.                                                                                           | Required whenever `NX_SECRETS_ENDPOINT` is set                        | Yes          |
| `NX_SECRETS_FILE`     | api, console, worker, compose        | The sealed credential file the panel writes when there is no secret manager, encrypted under a key derived from the master key. | Optional. Compose sets `/var/lib/nx-secrets/connections.sealed`       | Yes (path)   |

**Production refuses an environment key.** `masterKeySourceFromEnv` throws
`NX_KMS_ENDPOINT is required in production` rather than falling back, on the same reasoning as
the console's development session: a convenience that survives into a deployment is not a
convenience.

---

## The administration panel

| Name                         | Read by         | What it does                                                                                                                       | Required                                               | Secret |
| ---------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------ |
| `NX_OPERATOR_TOKEN`          | console, tests  | Makes the first owner at `/operator/login` and seals every staff session, so rotating it signs everybody out.                        | Required for the panel. 24 characters minimum, **43 in production** | Yes    |
| `NX_OPERATOR_TOKEN_OVERRIDE` | console, tests  | Stands in for the `x-nx-operator-token` header outside a request, so a build, a test or the screenshot harness can render a panel page. Refused in production. | Optional                                               | Yes    |
| `NX_OPERATOR_ID`             | scripts         | The staff name `pnpm provision` writes into the audit trail.                                                                        | Optional. Defaults to `nx-staff:provision`             | No     |
| `NX_MIGRATIONS_DIR`          | console         | Where the readiness screen counts `.up.sql` files, to report how many migrations the image carries.                                  | Optional. Defaults to `<cwd>/../../packages/db/migrations`; an unreadable path counts zero | No     |

The readiness screen also inspects `NX_SECRETS_ENDPOINT`, `NX_KMS_ENDPOINT`, `NX_MAIL_*`,
`NX_PUBLIC_BASE_URL`, `NX_CONSOLE_BASE_URL`, `NX_BANK_*`, `NX_OPERATOR_TOKEN` and `NODE_ENV` to
say what still blocks a launch
([packages/core/src/ops/readiness.ts](../../packages/core/src/ops/readiness.ts)).

---

## Data sources

| Name                       | Read by                       | What it does                                                                                                  | Required                    | Secret |
| -------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------- | ------ |
| `NX_PROVIDERS`             | api, console, worker, scripts | Which providers are active: `stub`, or `<name>:<base url>`, comma separated. Rows in `provider_connections` override this per environment. | Optional. Defaults to `stub` | No     |
| `NX_OPENBANKING_PROVIDERS` | api, console, worker, scripts | Providers that need two hosts: `<name>:<api url>;<auth url>`. A malformed entry throws at startup.              | Optional                    | No     |

This is the only difference between a sandbox deployment and a live one. No code branch anywhere
depends on which provider is configured.

---

## Addresses, the console and money

| Name                    | Read by               | What it does                                                                                                                  | Required                                                                  | Secret |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------ |
| `NX_CONSOLE_URL`        | console, worker, tests | Where the console lives: the identity provider's address to return to, and the link in a notification.                         | Optional. `http://localhost:3001` for auth, `https://console.nx.sa` for mail | No     |
| `NX_CONSOLE_BASE_URL`   | console               | The base a shared profile link (`/p/<token>`) is built from. A wrong value produces links that look right and open nothing.    | Optional, but readiness calls it **blocking** when unset                   | No     |
| `NX_PUBLIC_BASE_URL`    | api, console, scripts | Where a sealed evidence document can be checked. Printed on every document.                                                    | Optional. `https://verify.nx.sa` (api), `http://localhost:3000` elsewhere  | No     |
| `NX_API_URL`            | console, mcp          | The API's address: shown on the developer screens, and the address the MCP server calls.                                       | Optional in the console (`https://api.nx.sa`). **Required** by mcp         | No     |
| `NX_SUPPORT_EMAIL`      | console               | The support address on the support screen.                                                                                     | Optional. Defaults to `support@nx.sa`, which is wrong for most deployments | No     |
| `NX_BANK_ACCOUNT_NAME`  | console               | The account name shown for a bank transfer top-up. Unset makes the screen say so rather than print something wrong.            | Optional                                                                   | No     |
| `NX_BANK_NAME`          | console               | The bank's name beside the transfer reference.                                                                                 | Optional                                                                   | No     |
| `NX_BANK_IBAN`          | console               | The IBAN subscribers transfer to. Readiness warns when this or the account name is missing.                                    | Optional                                                                   | No     |
| `NX_CONSOLE_DIST_DIR`   | console               | The build output directory, so a check build does not clobber a running development server's `.next`.                          | Optional. Defaults to `.next`                                              | No     |
| `PORT`                  | api                   | The port the API listens on. The host is always `0.0.0.0`.                                                                     | Optional. Defaults to `3000`                                               | No     |

---

## Mail

| Name                | Read by | What it does                                                                                                  | Required                                     | Secret |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------ |
| `NX_MAIL_ENDPOINT`  | worker  | **Superseded by the panel** (ADR-141). Mail is configured under «إعدادات التحقق ← البريد» and the key goes to the secret store. This is kept only so a deployment set up before that keeps sending. | Optional | No |
| `NX_MAIL_TOKEN`     | worker  | Bearer token for that endpoint.                                                                                | Required whenever `NX_MAIL_ENDPOINT` is set  | Yes    |
| `NX_PANEL_OWNER_EMAIL` | worker  | The panel owner's address, made true at every start (ADR-142). Named for the panel, not the operator: `NX_OPERATOR_PASSWORD` is the `nx_operator` **database role**, a different secret entirely.                                                 | Optional                                     | No     |
| `NX_PANEL_OWNER_PASSWORD` | worker | That owner's password, typed into the sign in form by a person. **The variable wins**: changing it and redeploying changes the password and ends every session opened under the old one. A password changed inside the panel is overwritten at the next start. | Required whenever `NX_PANEL_OWNER_EMAIL` is set | Yes |
| `NX_PANEL_OWNER_NAME`  | worker  | The name shown beside that owner. «مالك المنصة» when absent.                                                    | Optional                                     | No     |
| `NX_MAIL_FROM`      | worker  | The from address on outgoing notification mail.                                                                | Required whenever `NX_MAIL_ENDPOINT` is set  | No     |

---

## The worker

| Name                  | Read by          | What it does                                                                                              | Required                                                        | Secret |
| --------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------ |
| `NX_WORKER_HEARTBEAT` | worker, compose  | The file the worker touches after every sweep. The container's health check reads its age; 90 seconds is stale. | Optional. Unset means no heartbeat and no health check. Compose sets `/tmp/nx-worker-heartbeat` | No     |

---

## The MCP server

| Name                           | Read by | What it does                                                                                               | Required                          | Secret |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------- | ------ |
| `NX_API_KEY`                   | mcp     | The subscriber's API key. It fixes the tenant for the whole process, because no tool takes a tenant argument. | Required. The process exits without it | Yes    |
| `NX_MCP_SPEND_CEILING_HALALAS` | mcp     | A spend ceiling that nothing the model sends can raise.                                                      | Optional. Defaults to `50000`     | No     |

---

## Development, tests and tooling

| Name                      | Read by                    | What it does                                                                                                                                                      | Required                                        |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `NODE_ENV`                | everything                 | The master switch. `production` refuses the environment key path, the environment secret store, the console's development session and the token acting as an operator, and turns on HSTS and secure cookies. | Optional. The image hard-sets `production`      |
| `NX_CONSOLE_TENANT_ID`    | console, tests             | The workspace for the console's development session, when there is no session cookie. Throws in production.                                                        | Optional                                        |
| `NX_CONSOLE_USER_ID`      | console, tests             | The user for that development session.                                                                                                                            | Optional                                        |
| `NX_CONSOLE_ROLE`         | console                    | The role for that development session. Defaults to `ADMIN`.                                                                                                       | Optional                                        |
| `NX_SECRETS_LAYERED_TEST` | tests                      | An alternative variable name for an environment secret store, so one test can populate a store without touching `NX_SECRETS`.                                      | Test only                                       |
| `NX_DEMO_API`             | scripts                    | The API the demo walkthrough polls. Defaults to `http://localhost:3000`.                                                                                           | Optional                                        |
| `NX_DEMO_CONSOLE`         | scripts                    | The console the demo prints. Defaults to `http://localhost:3001`.                                                                                                  | Optional                                        |
| `NX_SMOKE_API`            | scripts                    | The API the smoke test drives. Defaults to `http://localhost:3000`.                                                                                                | Optional                                        |
| `BASE`                    | tests                      | The address the screenshot and navigation harnesses drive. Defaults to `http://localhost:3101`, except `verify/shoot.mjs` which defaults to `http://localhost:3000`. | Optional                                        |
| `PW_CHANNEL`              | tests                      | The browser channel to launch, such as `chrome`, instead of the bundled build.                                                                                     | Optional                                        |
| `CUSTOMER_ID`             | tests                      | Pins which customer the screenshot run opens rather than discovering one.                                                                                          | Optional                                        |

Set but not read by this codebase: `COREPACK_HOME` (the Dockerfile, for corepack),
`POSTGRES_PASSWORD` and `POSTGRES_DB` (consumed by the postgres image), and `CI` (read by the
tooling).

---

## Checking a machine

```bash
bash scripts/check-secrets-hygiene.sh
```

Reads the permissions of `.env`, the length of the operator token, where the master key comes
from, the database role passwords, and whether the file is tracked by git. It prints no value
and sends nothing anywhere.
