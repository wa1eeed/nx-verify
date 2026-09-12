-- 0040: what the readiness screen needs to read.
--
-- The screen answers one question for whoever installs a deployment: is this thing
-- actually set up. Two of its answers were out of reach of the operator role.
--
-- A product row is configuration and not a subscriber's data: a code, a name, an input
-- schema and a partial policy, identical in every deployment and identical for every
-- subscriber. What a subscriber bought from that catalogue lives in packages and in
-- tenant_product_overrides, and what they verified lives in tables this role still cannot
-- reach at all.
--
-- The migration ledger is a property of the deployment in the same way. It holds a
-- version, a name and a checksum, and says nothing about anybody.
--
-- Read only, deliberately, on both. Adding a product is a seed and changing the ledger is
-- a migration: neither is something typed into a panel at two in the morning.

SET LOCAL ROLE nx_migrator;

GRANT SELECT ON products, product_steps TO nx_operator;

RESET ROLE;
GRANT USAGE ON SCHEMA nx_meta TO nx_operator;
GRANT SELECT ON nx_meta.schema_migrations TO nx_operator;
