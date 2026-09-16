SET LOCAL ROLE nx_migrator;

DELETE FROM section_requirements WHERE section = 'PROPERTY';

DROP FUNCTION IF EXISTS app.service_cost(text, text);
DROP FUNCTION IF EXISTS app.resolve_service_providers(uuid, text, text);
DROP TABLE IF EXISTS provider_usage;
DROP TABLE IF EXISTS product_provider_routing;
