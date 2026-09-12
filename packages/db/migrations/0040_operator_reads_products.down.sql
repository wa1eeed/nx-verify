SET LOCAL ROLE nx_migrator;

REVOKE SELECT ON products, product_steps FROM nx_operator;

RESET ROLE;
REVOKE SELECT ON nx_meta.schema_migrations FROM nx_operator;
REVOKE USAGE ON SCHEMA nx_meta FROM nx_operator;
