# Contributing

How work is done in this repository: the loop, the rules that may not be broken, the style, and
what a pull request has to carry before anybody reads it.

---

## Before anything

Read [CLAUDE.md](CLAUDE.md). It holds twelve rules that outrank every other document here, and
breaking one is a defect to be fixed immediately, not a preference to be discussed. Then read
`docs/progress.md` for what is built and what is left.

The twelve, in short:

1. `attestations` takes no UPDATE and no DELETE. New knowledge is a new row.
2. No query crosses tenants. A query without `tenant_id` is a defect, internal reports included.
3. Row level security on every table that carries `tenant_id`. Two layers, never one.
4. No identity number in plain text, in any column, log, error message or backup.
5. No provider name in any public response. The exposed field is `authority`.
6. Every field carries `authority` and `observed_at`. No free notes, no user-entered fields.
7. Every POST accepts `Idempotency-Key` and honours it: same key, same result, one charge.
8. Products are rows in the database, not branches in code.
9. No optimisation before measurement.
10. No credential in the database. `credential_ref` points at a key service.
11. Real PostgreSQL in tests. No SQLite, no in-memory database, no mock of the database layer.
12. The application role is not the owner role, and has no BYPASSRLS.

---

## The loop

One unit of work per session. Building several at once makes the last of them the weakest.

1. Read `CLAUDE.md` and `docs/progress.md`.
2. **Present the plan for the unit and wait for approval before writing code.**
3. Build one unit.
4. Write its tests and run them until they pass.
5. Run the architecture guards, all of them.
6. Update `docs/progress.md`: what was built, what is left, what was decided and why.

Any architecture decision goes into `docs/decisions.md` in the standing format: context,
decision, rejected alternatives, outcome.

---

## Style

**Language.** Code, comments and identifiers in English. The user interface and its error
messages in Arabic. This documentation in English.

**No em dash**, anywhere, in any text. Use a comma, a colon, a full stop or a middle dot.
`scripts/check-style.sh` enforces it and runs in CI.

**Comments say why.** A comment that restates the line above it is noise; a comment that says
what goes wrong without this line is the reason the line survives a refactor. Read a few files
before writing: the density and the voice are consistent, and a contribution that reads
differently reads as a contribution from somewhere else.

**Error codes are ours** (`NX-4031`), never a provider's, and each carries `retryable` and a
`request_id`. There are nine of them and the list is closed: see
[the API reference](docs/reference/api.md). Do not invent one.

**Money** is in Saudi riyals, stored without tax, with tax calculated at display.

**The interface** is governed by the design rules at the end of `CLAUDE.md` and by the handoff
in `design_handoff_verification_platform/`. No colour, spacing, radius or shadow is ever written
as a value: every one comes from a token. `pnpm design:check` refuses a violation.

---

## Tests

Tests run against real PostgreSQL 16 through Testcontainers, at the same version production
runs. Docker must be running.

```bash
pnpm run test       # everything
pnpm run guards     # the ten architecture guards alone
```

The guards are written before the logic they guard and stay green for ever. A failing guard
stops a merge:

| Guard                         | What it proves                                                    |
| ----------------------------- | ----------------------------------------------------------------- |
| `01-attestations-immutable`   | UPDATE and DELETE both raise                                      |
| `02-tenant-isolation`         | Tenant A cannot see a row of tenant B                             |
| `03-idempotency`              | The same key gives the same result and one charge                 |
| `04-skipped-not-billed`       | A SKIPPED step costs zero                                         |
| `05-no-plaintext-identifiers` | No identifier in plain text in any column or log                  |
| `06-no-provider-leak`         | No provider name in any public response                           |
| `07-ttl-change-is-inert`      | Changing a time to live touches no attestation                    |
| `08-partial-success`          | A failed optional step returns PARTIAL, not ERROR                 |
| `09-sandbox-isolation`        | A sandbox run touches no real workspace, and its document says so |
| `10-price-covers-cost`        | No price below the cost of the call it makes                      |

A test that needs a fixture writes it through the domain layer. Inserting rows to make a screen
look full produces a screen that passes and a platform that does not work.

---

## Commits

One change per commit, and a message that explains the change to somebody reading it in a year.

```
type(scope): what changed, in the imperative

Why it mattered. What was broken, if something was. What was rejected and why,
if a reader would otherwise wonder. Wrapped at 80 columns.
```

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `style`, `test`. The scope is the unit or the
area (`panel`, `file`, `security`, `worker`, `ui`).

Write the subject as a statement about the product, not about the diff: «the merge stops at a
broken dependency» rather than «add CI job».

---

## Pull requests

Before asking for a review:

- [ ] `pnpm run lint` and `pnpm run format:check` are clean
- [ ] `pnpm run typecheck` is clean, for the workspace and for the console
- [ ] `pnpm run test` is green, including any test you added
- [ ] `pnpm run guards` is green
- [ ] `pnpm run style` is clean (no em dash, no unexplained `any` escape hatch)
- [ ] `pnpm run security` is clean (dependency audit, secret scanner over the tree and history)
- [ ] `pnpm run docs:check` is clean (no markdown link leads nowhere)
- [ ] `pnpm run migrate:verify` is green, if you touched a migration
- [ ] `pnpm design:check` is clean, if you touched the interface
- [ ] `pnpm design:responsive` is green, if you touched a screen
- [ ] `docs/progress.md` says what you built
- [ ] `docs/decisions.md` has an entry, if you decided something architectural
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]`
- [ ] The reference page your change touches is updated **in the same change**, not later:
      [configuration](docs/reference/configuration.md) for a variable,
      [database](docs/reference/database.md) for a migration,
      [api](docs/reference/api.md) for an endpoint,
      [scheduled tasks](docs/reference/scheduled-tasks.md) for a job

A screen is not finished until the final checklist at the end of
`design_handoff_verification_platform/README.md` has been worked through and the prototype has
been opened beside the running screen and compared.

---

## Things that have gone wrong before

Kept here because each cost a day, and each was invisible until somebody looked.

- **A job wired to a role that may not delete.** The database refused it on every sweep, the
  scheduler swallowed the error exactly as designed, and the platform's headline promise never
  ran and never said so. When a test proves something the database enforces, run it as the role
  that will actually run it in production.
- **A worker that exited zero after its first sweep.** An unreferenced timer let node exit, so
  every job ran once at startup and never again. Nothing said so.
- **A screen that looked right and shipped nothing.** Two coloured cards kept their light fill
  in dark mode, and their text vanished. A screenshot caught it; no assertion did.
- **A build that only fails in production.** A page prerendered at build time carried scripts
  with no nonce, so the content policy refused all of them. A development server never shows it.

The pattern in all four: a green test is not a working platform. Run the thing.
