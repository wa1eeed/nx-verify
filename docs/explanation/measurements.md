# Measurements

Rule 9 says no optimisation before measurement: no partitioning, no projection table, no cache,
before real numbers prove the need. This is where the numbers live.

Re-run them with:

```bash
NX_MEASURE=1 pnpm exec vitest run test/measure/lists.test.ts
```

The seed is written in bulk rather than through the domain layer, because what is measured is
the read. When these figures change, this file changes with them.

---

## 2026-09-16: the customers list at 50,000 customers

**Shape:** one workspace, 50,000 customers, 20 fields each, so 1,000,000 attestations. One
verification run per customer. Observation dates spread over three years, so freshness is a real
mixture. PostgreSQL 16 in a container on a developer's machine, after `ANALYZE`.

| What                                     | Rows returned | Time        |
| ---------------------------------------- | ------------: | ----------: |
| Customers list, first 100, no filter     |           100 | **timed out at 600,000 ms** |
| Customers list, freelancers only         |           100 |  23,998 ms  |
| Customers list, name search              |            11 |  20,377 ms  |
| Workspace summary, first 100             |           100 |  24,665 ms  |
| One customer file, every field           |            20 |       2 ms  |

**The verdict: the customers list does not work at this size.** A screen a subscriber opens
every day takes twenty four seconds when it answers at all, and the unfiltered case, which is
the default, did not answer inside ten minutes.

**Why.** `listCustomers` joins every entity to `entity_profile`, which is itself a window
function over every attestation joined to the freshness policy, then aggregates with
`array_agg`, then sorts by `max(observed_at)`, and only then takes 100 rows. Nothing narrows the
work before the aggregate, so the query builds a million rows to return a hundred. The filtered
cases are faster only because the filter cuts the set first, and even they are unusable.

**What still works.** One customer's file is 2 ms, because it is keyed on one entity. The
problem is the list, not the projection.

**What this licenses.** Rule 9 is satisfied for this screen: there is a number, it is bad, and
optimisation is now warranted rather than speculative. What it does **not** license is
optimising anything else on a hunch.

---

## 2026-09-16, later the same day: the same list, after ADR-140

Same shape, same machine, same seed. Nothing else running: the first attempt at this table was
taken while the test suite was running beside it and every figure was ten times worse, which is
worth saying because it is the easiest way to measure nothing at all.

| What                                     | Rows returned | Before      | After      |
| ---------------------------------------- | ------------: | ----------: | ---------: |
| Customers list, first 100, no filter     |           100 | **timed out at 600,000 ms** | **290 ms** |
| Customers list, freelancers only         |           100 |  23,998 ms  |    193 ms  |
| Customers list, name search              |            11 |  20,377 ms  |     78 ms  |
| Workspace summary, first 100             |           100 |  24,665 ms  |    370 ms  |
| One customer file, every field           |            20 |       2 ms  |      2 ms  |

And the figures for what the console actually does now, which had no «before» because the screen
did not work this way:

| What                                        | Rows | Time     |
| ------------------------------------------- | ---: | -------: |
| A page of 25, chosen from the standing table |   25 |  119 ms  |
| That page summarised live                    |   25 |   80 ms  |
| The seven facet counts                       |    7 |  127 ms  |
| One sweep of 200 customers, in the worker    |  200 |  588 ms  |

**The one number that decided the design.** The same twenty five customers' profiles, three
ways:

| How                                     | Rows | Time      |
| --------------------------------------- | ---: | --------: |
| `entity_id = $2`, one customer           |   20 |    2 ms   |
| `entity_id = ANY(array of 25)`           |  500 |  782 ms   |
| One query each, in a loop                |  500 |   35 ms   |

`entity_profile` is a `DISTINCT ON` whose keys include `entity_id`, so a **constant** on that
column is pushed into it. An array is one qual over the whole view and is not, and a `LATERAL`
over the ids is a parameterised one and is not either: that was measured at twenty seconds and
is the worst of the three. So the loop is the fast path, not a fallback, and twenty five round
trips on one connection cost twenty times less than the one query that reads better.

**An index that was added and then narrowed.** A general
`(tenant_id, field_path, entity_id) WHERE superseded_by IS NULL` was added for the facets and
measured: reading a **single** customer's file went from 2 ms to **1,008 ms**, because that
index is a usable path for «every live attestation» and the planner took it for a question
nobody asked. It is a single-field-path partial index now, and the file read is 2 ms again.
Adding an index is a change that has to be measured like any other.

**What is still true.** Rule 9 has not been suspended. Nothing else on this list has been
optimised, because nothing else has a number saying it should be.

---

**Where a real subscriber sits.** A bank onboarding a hundred merchants a month reaches 50,000
customers in forty years and 5,000 in four. A payments provider onboarding a hundred a day
reaches 50,000 in eighteen months. So this is not a distant problem for the second kind of
customer, and it is not urgent for the first.
