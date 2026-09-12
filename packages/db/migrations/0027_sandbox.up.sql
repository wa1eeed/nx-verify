-- 0027: a sandbox that is a workspace, not a flag.
--
-- Every customer asks for Sandbox/UAT before they sign, and the obvious implementation is
-- a column: mark the run, skip the charge, hide it from the reports. That implementation
-- leaks. It leaks because every query in the platform then has to remember the column,
-- and the day one forgets, a test verification appears in a compliance officer's file and
-- is indistinguishable from a real one.
--
-- So a sandbox is a workspace of its own, linked to the real one. Isolation is then the
-- mechanism we already trust and already test: row level security. No query changes, no
-- column to forget, and a test run cannot reach production data because it is not in the
-- same tenant.
--
-- Everything else follows from data rather than code. The sandbox workspace is bound to
-- the stub provider, so it answers without touching an authority or costing anything. It
-- is put on a plan that includes every module, because the point of a sandbox is to try
-- them. And its wallet is funded with play money, so the billing path runs exactly as it
-- does in production rather than being skipped and therefore untested.

SET LOCAL ROLE nx_migrator;

ALTER TABLE tenants
  -- The real workspace this sandbox belongs to. NULL means this is a real one.
  ADD COLUMN sandbox_of uuid REFERENCES tenants(id),
  ADD CONSTRAINT ck_sandbox_not_self CHECK (sandbox_of IS NULL OR sandbox_of <> id);

-- One sandbox per workspace. Two would be two sets of test data nobody can tell apart.
CREATE UNIQUE INDEX uq_tenant_sandbox ON tenants (sandbox_of) WHERE sandbox_of IS NOT NULL;

/**
 * A sandbox cannot own a sandbox.
 *
 * Without this, a chain of sandboxes is possible, and the question "is this real" stops
 * having a single answer.
 */
CREATE FUNCTION app.tenants_no_nested_sandbox() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.sandbox_of IS NOT NULL
     AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = NEW.sandbox_of AND t.sandbox_of IS NOT NULL)
  THEN
    RAISE EXCEPTION 'a sandbox workspace cannot own another sandbox' USING ERRCODE = 'NX006';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenants_no_nested_sandbox
  BEFORE INSERT OR UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION app.tenants_no_nested_sandbox();

-- The operator reads and writes the link, because creating a sandbox is provisioning.
-- The application reads it so that a screen and a document can say which world they are
-- in, and writes nothing: a workspace must not be able to declare itself a sandbox.
GRANT UPDATE (sandbox_of) ON tenants TO nx_operator;

-- The grant alone is not enough: row level security is forced on this table, so without a
-- policy the update matches nothing and reports success on zero rows, which is the worst
-- kind of failure. The column grant above is what keeps this narrow.
CREATE POLICY operator_link_sandbox ON tenants
  FOR UPDATE
  TO nx_operator
  USING (true)
  WITH CHECK (true);

/**
 * The public check learns one more thing: whether the seal was a test.
 *
 * This function was written to return three values and no more, and widening it is a
 * decision rather than a convenience. It is made because the alternative is worse: a
 * document sealed in a sandbox looks exactly like a real one to the person holding it,
 * and that person has no account here and no other way to find out. Saying so reveals
 * nothing about any subject, and refusing to say so is how a test document ends up in a
 * credit file.
 */
GRANT CREATE ON SCHEMA app TO nx_auth;
SET LOCAL ROLE nx_auth;

-- The return type changes, and PostgreSQL will not replace a function whose shape moved,
-- so it is dropped and written again under the same owner.
DROP FUNCTION app.resolve_evidence_token(text);

CREATE FUNCTION app.resolve_evidence_token(token text)
  RETURNS TABLE (content_hash bytea, signed_at timestamptz, expires_at timestamptz, sandbox boolean)
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT e.content_hash, e.signed_at, e.expires_at, (t.sandbox_of IS NOT NULL)
  FROM evidence e
  JOIN tenants t ON t.id = e.tenant_id
  WHERE e.public_token = token
    AND (e.expires_at IS NULL OR e.expires_at > now())
  LIMIT 1;
$$;

SET LOCAL ROLE nx_migrator;
REVOKE CREATE ON SCHEMA app FROM nx_auth;
GRANT EXECUTE ON FUNCTION app.resolve_evidence_token(text) TO nx_app;
