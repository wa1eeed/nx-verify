SET LOCAL ROLE nx_migrator;

UPDATE products SET decision_ruleset = NULL;
ALTER TABLE products DROP CONSTRAINT IF EXISTS fk_products_ruleset;

REVOKE ALL ON decision_rules, decision_rulesets FROM nx_app, nx_retention;
DROP POLICY IF EXISTS t_isolation ON decision_rules;
DROP POLICY IF EXISTS t_isolation ON decision_rulesets;
DROP TABLE IF EXISTS decision_rules;
DROP TABLE IF EXISTS decision_rulesets;
