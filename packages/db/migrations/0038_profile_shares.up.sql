-- 0038: a verified profile a third party can open, without an account and without a leak.
--
-- The file is worth something outside the subscriber's own screen. A bank asked to open an
-- account for a merchant, a marketplace deciding whether to list a seller, a financier
-- looking at a contractor: all of them are shown a folder of scans today, and a scan
-- proves nothing about when it was true.
--
-- What makes this safe to publish is subtraction, and every one of these is a column that
-- is deliberately absent or a value deliberately not stored:
--
-- The token is not here. Its hash is. A table of live share links is readable by everyone
-- who can read the table, and a leaked backup of it would open every profile ever shared.
--
-- The identifier is not here and is not shown. The page masks it exactly as the console
-- does, because rule 4 does not relax for a reader we chose to trust.
--
-- The provider is not here and is never rendered. The page carries the authority, which
-- is the official body, and nothing about who we asked (rule 5).
--
-- And an expiry is mandatory rather than optional. A link with no end is a disclosure with
-- a delay: the person who opened it keeps it, changes job, and it still works.

SET LOCAL ROLE nx_migrator;

CREATE TABLE profile_shares (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  entity_id     uuid NOT NULL,
  -- SHA-256 of the token. The token itself is shown once, when it is issued.
  token_hash    bytea NOT NULL UNIQUE,
  -- Which groups of facts the recipient may see. A bank needs the account and the
  -- registry, not the deeds, and sharing everything because it was easier is how a
  -- disclosure becomes a complaint.
  groups        text[] NOT NULL,
  purpose       text,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  -- So the person who shared it can see it was opened. Accountability, not analytics:
  -- there is no column here for who opened it or from where.
  view_count    int NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  CONSTRAINT ck_share_groups CHECK (array_length(groups, 1) >= 1),
  CONSTRAINT ck_share_hash CHECK (octet_length(token_hash) = 32),
  CONSTRAINT fk_share_entity FOREIGN KEY (tenant_id, entity_id)
    REFERENCES entities (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_shares_entity ON profile_shares (tenant_id, entity_id, created_at DESC);

ALTER TABLE profile_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_shares FORCE ROW LEVEL SECURITY;
CREATE POLICY t_isolation ON profile_shares
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

REVOKE ALL ON profile_shares FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON profile_shares TO nx_app;
GRANT SELECT, DELETE ON profile_shares TO nx_retention;

-- The public lookup, like the API key lookup, cannot be tenant scoped: it is presented by
-- someone who has no account. It answers with the workspace and entity the link points at
-- and the groups it opens, and refuses a link that has expired or been revoked. It takes
-- the hash, so the token never reaches the database in readable form.
CREATE FUNCTION app.resolve_profile_share(token_hash bytea)
  RETURNS TABLE (share_id uuid, tenant_id uuid, entity_id uuid, groups text[])
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT s.id, s.tenant_id, s.entity_id, s.groups
  FROM profile_shares s
  WHERE s.token_hash = resolve_profile_share.token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
  LIMIT 1;
$$;

GRANT SELECT ON profile_shares TO nx_auth;
CREATE POLICY share_public_lookup ON profile_shares
  FOR SELECT
  TO nx_auth
  USING (revoked_at IS NULL);

GRANT CREATE ON SCHEMA app TO nx_auth;
ALTER FUNCTION app.resolve_profile_share(bytea) OWNER TO nx_auth;
REVOKE CREATE ON SCHEMA app FROM nx_auth;
REVOKE ALL ON FUNCTION app.resolve_profile_share(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_profile_share(bytea) TO nx_app;
