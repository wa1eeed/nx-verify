# NX Trust documentation

Organised the way [Diátaxis](https://diataxis.fr) suggests. Each page is one kind of document,
because a page that teaches and specifies at the same time does neither well.

| Kind            | Answers                       | Read it when                          |
| --------------- | ----------------------------- | ------------------------------------- |
| **Tutorial**    | "Take me through it once"     | You are new and want it working       |
| **Guide**       | "How do I do X?"              | You have a task                       |
| **Reference**   | "What exactly is X?"          | You need a fact, exactly              |
| **Explanation** | "Why is it like this?"        | You are about to change something     |

The rules in [CLAUDE.md](../CLAUDE.md) outrank every document here.

---

## Tutorials

| Page                                                       | What it does                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| [first-verification.md](tutorials/first-verification.md)   | From a clone to a verified customer on screen, in about fifteen minutes  |

## Guides

| Page                                                                   | Task                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [development-environment.md](guides/development-environment.md)        | Set up a machine to work on the platform                               |
| [add-a-verification-product.md](guides/add-a-verification-product.md)  | Add a product as rows, without a release                               |
| [connect-a-data-source.md](guides/connect-a-data-source.md)            | Connect a registry or bank source, per environment, from the panel     |
| [deploy-production.md](guides/deploy-production.md)                    | Stand up production, in order, with what blocks a launch               |
| [deploy-staging.md](guides/deploy-staging.md)                          | Build staging as a copy of production                                  |
| [backup-and-restore.md](guides/backup-and-restore.md)                  | Back up the database, the sealed store and the keys, and prove it      |
| [run-a-migration.md](guides/run-a-migration.md)                        | Write, review and run a migration, and roll one back                   |
| [incident-response.md](guides/incident-response.md)                    | What to do first when something is wrong, including a leaked credential |

## Reference

| Page                                                       | Facts about                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [configuration.md](reference/configuration.md)             | Every environment variable, who reads it, what it defaults to                |
| [database.md](reference/database.md)                       | Every table, column, role, policy and migration                              |
| [api.md](reference/api.md)                                 | Every endpoint, scope, error code, idempotency and webhook                   |
| [scheduled-tasks.md](reference/scheduled-tasks.md)         | Every worker job, its interval and its role, and the planned work ahead      |
| [design-system.md](reference/design-system.md)             | Tokens, the component layer, and the rules a screen obeys                    |
| [glossary.md](reference/glossary.md)                        | The vocabulary, in Arabic and English                                        |

## User guides

| Page                                                          | For                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| [subscriber-console.md](guides/subscriber-console.md)         | The people who use the console every day                  |
| [administration-panel.md](guides/administration-panel.md)     | Platform staff: prices, subscribers, the data source       |

## Explanation

| Page                                                              | The reasoning behind                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------- |
| [architecture.md](explanation/architecture.md)                    | The shape of the system, and the path a verification takes    |
| [multi-tenancy.md](explanation/multi-tenancy.md)                  | How one product serves many subscribers without leaking       |
| [security-model.md](explanation/security-model.md)                | The threat model, the data classes, and the controls          |
| [testing-strategy.md](explanation/testing-strategy.md)            | Why the guards exist and why the database in tests is real    |

## Working record

These are the project's own documents. They are in Arabic, and they are where a decision or a
piece of history is recorded rather than explained.

| Page                                   | What it holds                                                          |
| -------------------------------------- | ---------------------------------------------------------------------- |
| [00-START-HERE.md](00-START-HERE.md)   | The orientation every session starts from                              |
| [01-blueprint.md](01-blueprint.md)     | The product as a whole: positioning, modules, screens, commercial model |
| [02-schema.md](02-schema.md)           | The schema as designed, beside the reference of what exists            |
| [03-products.md](03-products.md)       | The product catalogue: inputs, steps, dependencies, partial success    |
| [04-install.md](04-install.md)         | Installing a deployment, sandbox first                                 |
| [05-secrets.md](05-secrets.md)         | Every secret, its home and its rotation (in English)                   |
| [decisions.md](decisions.md)           | 134 architecture decisions, with what was rejected and why             |
| [decisions-index.md](decisions-index.md) | An index of all of them, by what each decided                        |
| [progress.md](progress.md)             | What is built, what is left, and every session's record                |

And outside this folder: [CHANGELOG.md](../CHANGELOG.md) for what changed when, and
[CONTRIBUTING.md](../CONTRIBUTING.md) for how work is done.
