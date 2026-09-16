# Testing strategy

Why the tests are shaped the way they are, why the database in them is real, and why a green
suite is still not a working platform.

---

## The shape

1,097 tests across 98 files, and ten of those files are architecture guards.

| Kind                 | Runs against                          | Answers                                                         |
| -------------------- | ------------------------------------- | --------------------------------------------------------------- |
| Architecture guards  | Real PostgreSQL                       | Is a rule that may not be broken still unbroken                  |
| Domain tests         | Real PostgreSQL                       | Does the logic do what it claims, on the storage it will use     |
| API tests            | A built Fastify instance, real database | Does the contract hold, including its refusals                 |
| Screen tests         | Rendered markup                       | Does the screen say and offer what the rules require             |
| Design checks        | The source, then a real browser       | Is a value written where a token belongs; does a screen fit a phone |
| Walkthroughs         | A running deployment in a browser     | Does the thing actually work                                     |

---

## The database is real, always

No SQLite, no in-memory substitute, no mock of the database layer (rule 11). Testcontainers
starts the same PostgreSQL major version production runs.

The reason is not purity. Row level security is a PostgreSQL feature, and the platform's central
claim, that one subscriber cannot see another's data, is enforced by policies and grants. A test
of that claim against anything else is a test of nothing.

The same applies to everything the schema enforces: the trigger that refuses an edited
attestation, the check that refuses a billed amount on a skipped step, the unique index that
makes idempotency a race the duplicate loses. A mock would pass while the real thing failed, or
worse, the reverse.

It also means the tests run as **the application role**, not the owner. A test run as the owner
bypasses the very policies it is asserting, and passes while proving the opposite.

---

## The ten guards

Written before the logic they guard, and green for ever. A failing guard stops a merge.

| Guard                         | Proves                                                                |
| ----------------------------- | --------------------------------------------------------------------- |
| `01-attestations-immutable`   | UPDATE and DELETE both raise                                          |
| `02-tenant-isolation`         | Tenant A cannot see, write or delete a row of tenant B                |
| `03-idempotency`              | The same key returns the same result and charges once                 |
| `04-skipped-not-billed`       | A skipped step costs zero                                             |
| `05-no-plaintext-identifiers` | No identifier in plain text in any column, log or error               |
| `06-no-provider-leak`         | No provider name in any public response                               |
| `07-ttl-change-is-inert`      | Changing a time to live touches no attestation                        |
| `08-partial-success`          | A failed optional step returns PARTIAL, not ERROR                     |
| `09-sandbox-isolation`        | A sandbox run touches no real workspace, and its document says so     |
| `10-price-covers-cost`        | No price below the cost of the call it makes                          |

They are different from ordinary tests in one way that matters: an ordinary test describes what
the code does today, and may legitimately be changed when the code changes. A guard describes
what may never be true. Changing one to make it pass is the defect.

---

## Fixtures go through the domain

A test that needs data writes it the way the platform writes it: through the provider adapter,
the normalisation, the pricing and the sealing. Inserting rows directly produces a screen that
looks full, a test that passes, and a platform that does not work.

The demonstration script follows the same rule for the same reason: everything on those screens
came through the domain layer.

---

## What a test cannot see

Four defects in this project's history were invisible to a green suite. Each is now a rule.

**A job wired to a role that may not delete.** The retention sweep was refused by the database on
every run, the scheduler swallowed the error exactly as designed, and the promise that a
customer's data is destroyed after the agreed period had never once been kept. The test was green
because it ran as the owner. *Run a test as the role that will run it in production.*

**A worker that exited zero after its first sweep.** An unreferenced timer let node exit. Every
job ran once at startup and never again, with an exit code that told nobody. *There is now a test
that spawns a real process and waits.*

**A screen that shipped nothing.** Two coloured cards kept their light fill in dark mode and
their text vanished. A screenshot caught it; no assertion did. *Screens are photographed, and
`pnpm design:responsive` walks every one of them at three widths.*

**A build that only fails in production.** A page prerendered at build time carried scripts with
no nonce, so the content security policy refused all of them: the page arrived without its own
code. A development server never shows this. *A real production build is walked before a security
change is called done.*

The pattern is the same every time. A green test is a statement about code. Whether the platform
works is a different question, and the only way to answer it is to run the thing.

---

## Running them

```bash
pnpm run test              # everything, about 90 seconds
pnpm run guards            # the ten guards alone
pnpm run migrate:verify    # up, down, up again, and compare the schema
pnpm run security          # dependency audit and the secret scanner
pnpm design:check          # no value written where a token belongs
pnpm design:responsive     # every screen at three widths, in a browser
```

Docker must be running: the tests start their own database.

---

## Writing one

- Name it after the behaviour, not the function: `refuses a code that has already been used`.
- One assertion's worth of meaning per test; several `expect` calls proving one statement are
  fine.
- Say in the file's header comment what class of defect these tests exist to catch. Every test
  file here has one, and it is the part somebody reads first in a year.
- If you are testing a refusal, test that it refuses **and** that the thing it protects is
  unchanged.
