# Multi-tenancy

How one product serves many subscribers without any of them seeing another, and why the
protection is in the database rather than in the code.

---

## The claim

Every subscriber's data is invisible to every other subscriber, and that is true even if somebody
writes a query that forgets to filter.

A platform that holds Saudi identity numbers and moves money cannot make that claim on the
strength of a `WHERE` clause. A `WHERE` clause is a thing a person remembers to write.

---

## Two layers, never one

**The first layer is the code.** Every query passes through `withTenant(pool, tenantId, handler)`,
which opens a transaction, sets the tenant for its duration, and hands over a transaction handle.
There is no other way to reach the database from the domain layer.

**The second layer is the database.** Every table carrying `tenant_id` has row level security
enabled *and forced*, with a policy that reads:

```sql
USING (tenant_id = app.current_tenant())
WITH CHECK (tenant_id = app.current_tenant())
```

`app.current_tenant()` reads a setting that `withTenant` sets per transaction. When it is unset,
it returns NULL, and NULL matches nothing: **failure is closed.** A query outside a tenant scope
returns zero rows rather than every row.

`WITH CHECK` matters as much as `USING`: without it, a workspace could read only its own rows and
write rows belonging to somebody else.

---

## Forced, so the owner is not exempt

PostgreSQL exempts a table's owner from its own row level security by default. A test suite run
as the owner therefore passes every isolation test while proving nothing.

Every tenant table here is `FORCE ROW LEVEL SECURITY`, and the application role owns nothing at
all. That is rule 12, and it exists because the alternative is a green test suite and a leak.

---

## Four roles

| Role           | What it is for                                                        | May it bypass RLS |
| -------------- | --------------------------------------------------------------------- | ----------------- |
| `nx_migrator`  | Owns the tables and runs the migrations. Nothing else uses it          | No                |
| `nx_app`       | Every request. Owns nothing                                            | No                |
| `nx_retention` | The only role that may delete an attestation                           | No                |
| `nx_operator`  | The administration panel: configuration and money, never a verification | No                |

None of them is `SUPERUSER` and none has `BYPASSRLS`. The separation is what makes each of the
following statements enforceable rather than aspirational:

- A bug in a request handler cannot delete an attestation, because its role holds no `DELETE` on
  that table.
- The panel cannot read a customer's file, because its role has no grant on `attestations`,
  `entities` or `verification_runs`.
- The retention sweep cannot touch a financial record, because it holds `SELECT` only on
  `topup_requests`.

---

## The fifth role, and the one thing that cannot be tenant-scoped

There is a lookup that must happen *before* anybody knows which tenant is asking: resolving an API
key, a session, a login, a public evidence token, a shared profile link.

That is `nx_auth`: a role that cannot log in, owns six `SECURITY DEFINER` functions and nothing
else, and is executable only by `nx_app`. Each function returns the minimum needed to establish a
tenant and nothing more. `resolve_api_key` returns a tenant, a key id, its scopes and its
environment; it cannot be asked anything else.

So the exception is real, it is six functions wide, and it is visible.

---

## Impossible by storage, not only by policy

A foreign key between two tenant-scoped tables is **composite**:

```sql
FOREIGN KEY (tenant_id, entity_id) REFERENCES entities (tenant_id, id)
```

A row therefore cannot point at another tenant's row even in principle. Policy refuses the read;
the key refuses the relationship. Two different mechanisms, one for each way this goes wrong.

---

## Sandbox is a workspace, not a flag

A subscriber's test world is a **second tenant**, linked by `tenants.sandbox_of`. That decision
produces several properties for free:

- Isolation between test and live is the same isolation as between two subscribers: row level
  security, already proven.
- A key belongs to a workspace, and a database trigger forces its environment to match. A
  `nx_test_` key on a live workspace cannot be created.
- Test data never has to be filtered out of a report, because it is not in the same workspace.
- A sandbox cannot have a sandbox, and a trigger says so.

The alternative, a boolean column on every table, would mean every query, every count and every
invoice needs to remember it. One of them eventually would not.

---

## Statistics without reading anything

Rule 2 says no query crosses tenants, and it says internal reports included. A dashboard that
reads raw rows across workspaces is exactly the query that leaks.

So counts come from aggregated counters written as work happens: `product_usage`,
`margin_counters`. Staff read margin per subscriber per product without a single verification
being readable by them.

---

## How this is proven

Guard `02-tenant-isolation` runs on real PostgreSQL, as the application role, and asserts that
tenant A cannot see, update or delete a row belonging to tenant B, including through a view and
through a join.

It runs on real PostgreSQL because row level security is a PostgreSQL feature: proving isolation
on SQLite or against a mock proves nothing at all (rule 11). And it runs as the application role
because proving it as the owner proves the opposite of what it claims.
