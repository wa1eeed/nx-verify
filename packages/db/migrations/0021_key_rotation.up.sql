-- 0021: making key rotation possible.
--
-- docs/01-blueprint.md section 10 promises credential and key rotation every ninety days,
-- and the platform as built could not do it. The identifier hash is the lookup index
-- (uq_ident), and it is an HMAC under a key derived from a single root with no version
-- recorded anywhere. Rotating that root would have left every hash unmatchable and every
-- ciphertext undecryptable, and identity resolution would have stopped working entirely.
--
-- So a promise was documented that the schema made impossible. This is the fix.
--
-- Each protected value now records which key version produced it. Several versions are
-- live at once: new values are written with the current one, existing values keep being
-- read with theirs, and a job walks the rows and moves them over. Rotation becomes a job
-- rather than an outage.
--
-- Evidence records its version too, and for a different reason. Re-keying an identifier
-- is a rewrite of storage; re-signing evidence would change a seal a customer has already
-- shown to an auditor. Old evidence keeps its old key, for ever, and stays verifiable.

SET LOCAL ROLE nx_migrator;

CREATE TABLE key_versions (
  version      int PRIMARY KEY CHECK (version > 0),
  status       text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'retiring', 'retired')),
  activated_at timestamptz NOT NULL DEFAULT now(),
  retired_at   timestamptz,
  notes        text,
  CONSTRAINT ck_retired_has_date CHECK (status <> 'retired' OR retired_at IS NOT NULL)
);

-- Only one version is written with at a time. A second active version would mean two
-- rows for the same identifier could hash differently and both be inserted.
CREATE UNIQUE INDEX uq_single_active_key ON key_versions ((status)) WHERE status = 'active';

INSERT INTO key_versions (version, status, notes)
VALUES (1, 'active', 'The first key. Present since the platform was built.');

-- The catalogue of versions is operator data: it says nothing about any tenant, and every
-- tenant reads through the same one.
REVOKE ALL ON key_versions FROM PUBLIC;
GRANT SELECT ON key_versions TO nx_app;
GRANT SELECT, INSERT, UPDATE ON key_versions TO nx_operator;

-- Existing rows were all written with version 1, which is what the default records.
ALTER TABLE entity_identifiers
  ADD COLUMN key_version int NOT NULL DEFAULT 1 REFERENCES key_versions(version);

CREATE INDEX ix_ident_key_version ON entity_identifiers (tenant_id, key_version)
  WHERE key_version <> 1;

ALTER TABLE evidence
  ADD COLUMN key_version int NOT NULL DEFAULT 1 REFERENCES key_versions(version);

-- Rotation rewrites the hash and the ciphertext of an identifier in place. That is a
-- change of representation, not a change of fact: the identifier is the same number, and
-- the entity it resolves to does not move. It is why entity_identifiers is an ordinary
-- table and attestations is not.
COMMENT ON COLUMN entity_identifiers.key_version IS
  'Which key version produced this hash and ciphertext. Rewritten in place by rotation.';
COMMENT ON COLUMN evidence.key_version IS
  'Which key version signed this seal. Never rewritten: a document already shown to an auditor keeps its signature.';
