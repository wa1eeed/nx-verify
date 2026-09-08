-- 0004: attestations are append only.
--
-- Rule 1: new knowledge is a new row. The single permitted mutation is setting
-- superseded_by once on the previous row. Deletion belongs to the retention job alone.
--
-- ADR-010 deviates from docs/02-schema.md, which proposed:
--
--   CREATE RULE att_no_update AS ON UPDATE TO attestations
--     WHERE OLD.superseded_by IS NOT NULL DO INSTEAD NOTHING;
--
-- That rule fails guard 01 on two counts. It permits any UPDATE to a row that is not yet
-- superseded, including a rewrite of value or observed_at, and it swallows the violation
-- silently instead of raising. CLAUDE.md prevails over the schema document.
--
-- Two layers again. Privileges make the operation unavailable, triggers make it an error.

SET LOCAL ROLE nx_migrator;

REVOKE UPDATE, DELETE ON attestations FROM nx_app;
GRANT UPDATE (superseded_by) ON attestations TO nx_app;

-- The retention role is the only role in the system holding DELETE on attestations.
GRANT DELETE ON attestations TO nx_retention;

CREATE FUNCTION app.attestations_forbid_update() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'attestation % is already superseded and cannot be modified', OLD.id
      USING ERRCODE = 'NX001';
  END IF;

  IF NEW.superseded_by IS NULL THEN
    RAISE EXCEPTION 'attestations are append only: superseded_by cannot be cleared'
      USING ERRCODE = 'NX001';
  END IF;

  IF (to_jsonb(NEW) - 'superseded_by') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_by') THEN
    RAISE EXCEPTION 'attestations are append only: superseded_by is the only mutable column'
      USING ERRCODE = 'NX001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_attestations_forbid_update
  BEFORE UPDATE ON attestations
  FOR EACH ROW EXECUTE FUNCTION app.attestations_forbid_update();

CREATE FUNCTION app.attestations_forbid_delete() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF pg_has_role(current_user, 'nx_retention', 'USAGE') THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'attestations may only be deleted by the retention role'
    USING ERRCODE = 'NX002';
END;
$$;

CREATE TRIGGER trg_attestations_forbid_delete
  BEFORE DELETE ON attestations
  FOR EACH ROW EXECUTE FUNCTION app.attestations_forbid_delete();
