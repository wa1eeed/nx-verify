# Guide: set up a development machine

For working on the platform rather than running it. If you only want to see it work, the
[tutorial](../tutorials/first-verification.md) is shorter.

---

## What you need

- Docker, running. The tests start their own PostgreSQL.
- Node 20.11 or newer. `corepack enable` provides pnpm 9.
- A terminal that renders Arabic. Every screen is right to left.

## Install

```bash
git clone https://github.com/wa1eeed/nx-verify.git
cd nx-verify
pnpm install
cp .env.example .env
chmod 600 .env
```

Fill in `.env`. For a development machine the minimum is the database passwords, `NX_MASTER_KEY`
and `NX_OPERATOR_TOKEN`, each generated with `openssl rand -base64 32`. Every variable is
described in [the configuration reference](../reference/configuration.md).

```bash
bash scripts/check-secrets-hygiene.sh
```

It reports what a deployment would need. On a development machine the length warnings are
expected; the permission and tracking checks are not.

## A database to work against

Two options.

**The compose database**, which is what the scripts assume:

```bash
docker compose up -d db
docker compose run --rm migrate
docker compose run --rm --no-deps api pnpm provision products:seed
```

**Or nothing at all**, if you are only running tests: they start their own container and throw it
away.

## Run the three processes

```bash
pnpm --filter @nx-verify/api run dev       # port 3000
pnpm --filter @nx-verify/console run dev   # port 3001
pnpm --filter @nx-verify/worker run start
```

The worker needs both connections: the application one to do the work, and the operator one to
read the list of workspaces and nothing else.

Set `NX_WORKER_HEARTBEAT` if you want `pnpm --filter @nx-verify/worker run health` to answer.

### Signing in during development

Outside production the console accepts a development session when there is no cookie, from
`NX_CONSOLE_TENANT_ID`, `NX_CONSOLE_USER_ID` and `NX_CONSOLE_ROLE`. It is refused in production,
and a production build always takes the production branch whatever the environment says, because
the framework replaces `NODE_ENV` at build time.

The panel accepts the deployment token in an `x-nx-operator-token` header outside production, for
scripts and screenshots. In production it opens nothing.

## The loop

```bash
pnpm run lint && pnpm run typecheck && pnpm run style
pnpm run test
pnpm run guards
```

Before a pull request, the checklist in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Working on a screen

```bash
pnpm design:check         # refuses a colour, spacing, radius or shadow written as a value
pnpm design:responsive    # every screen at three widths, in a browser
pnpm design:all <dir>     # photograph every screen into a directory
pnpm design:compare <before> <after>
```

Any interface change that is not supposed to move the design is proved with photographs before
and after. The prototype in `design_handoff_verification_platform/` is the reference, and the
final checklist at the end of its README is what finishes a screen.

## When something is odd

| Symptom                                        | Usually                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| Tests hang at startup                          | Docker is not running                                                   |
| `NX_APP_DATABASE_URL is not set`               | The process was started without the environment file loaded             |
| The console shows an empty list and no error   | The workspace has no data. Run the demonstration script                  |
| The panel refuses the token                    | Under 24 characters, or `NODE_ENV=production` where 43 are needed        |
| A screen 500s after an edit                    | A server file imported into a client component. Read the server log      |
| The worker does nothing                        | Every job is due at startup, so look for the startup line and the heartbeat |
