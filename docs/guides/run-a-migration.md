# Guide: write and run a migration

Every schema change is a numbered pair of files that runs forward and backward and leaves an
identical schema either way.

---

## Write it

Two files in `packages/db/migrations`, numbered after the last one:

```
0050_licence_checks.up.sql
0050_licence_checks.down.sql
```

Both begin by taking the owner role:

```sql
SET LOCAL ROLE nx_migrator;
```

### What an up migration must do

- **Carry the tenant**, if the table is tenant-scoped: a `tenant_id` column, a composite foreign
  key `(tenant_id, parent_id)` to a `UNIQUE (tenant_id, id)`, and a `UNIQUE (tenant_id, id)` of
  its own if anything will point at it.
- **Enable and force row level security**, and add the `t_isolation` policy:

```sql
ALTER TABLE licence_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE licence_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON licence_checks
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
```

Forcing it matters: without it the owner is exempt and every isolation test passes while proving
nothing.

- **Grant the least that works.** `nx_app` gets what a request needs. `DELETE` goes to
  `nx_retention` and to nobody else. The panel role gets nothing on verification data.
- **Say what the table is for**, with `COMMENT ON TABLE`. It is read by the next person and by
  the schema reference.
- **Write a vocabulary as a CHECK**, not an enum: widening one should be a reviewable migration.

### What a down migration must do

Undo exactly what the up did, in reverse. If the up added a column to a shared table, the down
drops that column and nothing else.

A down that cannot restore what was destroyed is a down that should not exist: split the
migration so the destructive half is separate and deliberate.

---

## Run it

```bash
pnpm migrate            # what is applied and what is pending
pnpm migrate up         # apply the pending ones
pnpm migrate down       # roll back the last one
```

Against a deployment's database, run it from the image so the version is the one that was built:

```bash
docker compose run --rm migrate
```

The runner runs as `nx_migrator`, the owner, and assigns the role passwords from the environment
afterwards. The ledger is `nx_meta.schema_migrations`.

---

## Prove it

```bash
pnpm run migrate:verify
```

This applies every migration, rolls all of them back, applies them again and compares the schema.
It uses Testcontainers rather than a service container, so CI and a developer's machine exercise
the same PostgreSQL.

`verify ok: up, down and up again produce an identical schema` is the only acceptable output.

Then:

```bash
pnpm run test
```

A migration that changes a vocabulary or a grant changes behaviour somewhere.

---

## Document it

In the same change, not later:

- `docs/reference/database.md`: the table, its columns, its policy, and a line in the migration
  list.
- `docs/decisions.md`: an entry, if it encodes a decision.
- `CHANGELOG.md`: under `[Unreleased]`.

---

## Things that have gone wrong

- **A grant that looked right and was not.** The retention job held no `DELETE`, the database
  refused it on every sweep, the scheduler swallowed the error as designed, and nothing was ever
  destroyed. Test a grant as the role that will use it.
- **A policy without `WITH CHECK`.** Reading was isolated and writing was not.
- **A vocabulary widened in code and not in the database.** The application accepted a value the
  `CHECK` refused, and the error arrived at the worst moment.
