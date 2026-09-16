SET LOCAL ROLE nx_migrator;

DROP INDEX IF EXISTS ix_att_address_key;
DROP INDEX IF EXISTS ix_runs_customer;
DROP INDEX IF EXISTS ix_change_entity;
DROP INDEX IF EXISTS ix_runs_entity;

DROP TABLE IF EXISTS customer_standing;
