# Guide: add a verification product

Rule 8: a product is rows in the database, never a branch in code. This is what that means in
practice.

You will add rows to three tables and nothing else. No deployment, no release, no code.

---

## The three tables

| Table            | Says                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| `products`       | What it is called, what subject it takes, and the schema that subject must match |
| `product_steps`  | Which provider endpoints it calls, in what order, and what feeds what   |
| `step_field_map` | How each path in the answer becomes a field, an entity or a relation    |

---

## 1. The product

```sql
INSERT INTO products (code, name_ar, name_en, subject_type, input_schema, partial_policy,
                      profile_section, applies_to, check_order, availability)
VALUES ('LICENCE_CHECK', 'رخصة النشاط', 'Activity licence', 'BUSINESS',
        '{"type":"object","required":["unn"],"properties":{"unn":{"type":"string"}}}'::jsonb,
        'BEST_EFFORT', 'REGISTRY', ARRAY['COMPANY','ESTABLISHMENT'], 60, 'AVAILABLE');
```

`input_schema` is a JSON Schema, and it is the only thing validating what a caller sends. Get it
right and a wrong subject is refused with 422 before a single provider call is made.

`partial_policy` decides what happens when an optional step fails: `BEST_EFFORT` returns
`PARTIAL`, `ALL_OR_NOTHING` returns an error. Guard 08 holds the difference.

`profile_section` and `applies_to` place the product as a section of a customer file. Either set
both or neither.

## 2. The steps

```sql
INSERT INTO product_steps (product_code, step_key, seq, provider, endpoint, input_binding,
                           depends_on, required)
VALUES ('LICENCE_CHECK', 'licence', 1, 'registry', 'business.licence',
        '{"unn": "$.subject.unn"}'::jsonb, '{}', true);
```

`input_binding` may reference `$.subject.*`, `$.steps.<key>.*` for a value from an earlier step,
or `literal:<value>`. `depends_on` makes the order a graph rather than a list, and a step may not
depend on itself.

An optional step (`required = false`) that fails leaves the run `PARTIAL` instead of failing it.

## 3. The field map

```sql
INSERT INTO step_field_map (product_code, step_key, source_path, field_path, entity_role)
VALUES ('LICENCE_CHECK', 'licence', 'licence.number', 'licence.number', 'SUBJECT'),
       ('LICENCE_CHECK', 'licence', 'licence.expires_at', 'licence.expires_at', 'SUBJECT');
```

For a list, one `[*]` wildcard is allowed in the path. For anything that is not the subject, the
row must also carry an `identifier_path` and an `entity_type`, so the other entity can be
resolved, and may carry a `relation_type` to record the link:

```sql
INSERT INTO step_field_map (product_code, step_key, source_path, field_path, entity_role,
                            entity_type, identifier_path, identifier_type_source, relation_type)
VALUES ('LICENCE_CHECK', 'licence', 'holders[*].name', 'holder.name', 'OWNER',
        'PERSON', 'holders[*].id', 'holders[*].id_type', 'OWNS');
```

A field path that ends in a company's identifier records a fact that is true only inside that
company, and the platform will keep it in that company's file rather than in the person's own.

## 4. The rest

**A time to live**, or the field never ages:

```sql
INSERT INTO freshness_policy (tenant_id, field_path, ttl_days, weight)
VALUES (NULL, 'licence', 180, 8);
```

**What a change means**, if it means something:

```sql
INSERT INTO change_severity_rules (tenant_id, field_path, severity, seq, reason_ar, reason_en)
VALUES (NULL, 'licence.status', 'CRITICAL', 10, 'تغيّرت حالة الرخصة', 'The licence status changed');
```

**A cost and a price.** A product with no price is refused, deliberately: a run with no price is
a run nobody knows who pays for. Guard 10 refuses a price below the cost of the call.

```bash
pnpm provision price:set --tenant <id> --product LICENCE_CHECK --amount 15.00
```

## 5. Prove it

```bash
curl -sS -X POST http://localhost:3000/v1/verifications \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" \
  -d '{"product":"LICENCE_CHECK","subject":{"unn":"7001272184"}}' | jq
```

`GET /v1/products` now offers it with its schema, the console shows it as a check, and the
customer file has a section for it. Nothing was deployed.

---

## The measurement

This is the test the architecture was designed to pass, and the one worth repeating whenever the
normalisation layer changes: **add a product with rows alone**. If it needs a line of code, stop
and fix that before going further, because every product after it will need one too.
