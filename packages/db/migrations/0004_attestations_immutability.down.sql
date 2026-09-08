SET LOCAL ROLE nx_migrator;

DROP TRIGGER IF EXISTS trg_attestations_forbid_delete ON attestations;
DROP TRIGGER IF EXISTS trg_attestations_forbid_update ON attestations;
DROP FUNCTION IF EXISTS app.attestations_forbid_delete();
DROP FUNCTION IF EXISTS app.attestations_forbid_update();

REVOKE DELETE ON attestations FROM nx_retention;
REVOKE UPDATE (superseded_by) ON attestations FROM nx_app;
GRANT UPDATE ON attestations TO nx_app;
