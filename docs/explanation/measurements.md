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

**Where a real subscriber sits.** A bank onboarding a hundred merchants a month reaches 50,000
customers in forty years and 5,000 in four. A payments provider onboarding a hundred a day
reaches 50,000 in eighteen months. So this is not a distant problem for the second kind of
customer, and it is not urgent for the first.
