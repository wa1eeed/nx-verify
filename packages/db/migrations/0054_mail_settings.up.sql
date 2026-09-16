-- 0054: how mail leaves this deployment, set from the panel instead of from the environment.
--
-- The notification queue, its templates, its channels and its retries have been built since
-- the notifications unit, and the transport has always been a seam: `MailTransport`, with an
-- HTTP implementation built from three environment variables. That was right while nobody had
-- to change it. It stops being right the moment the owner wants to point the platform at a
-- mail service, change the address it sends from, or rotate a key, because each of those is a
-- deployment and a restart today.
--
-- So the address, the name and which service carries the mail become a row. The key does not:
-- rule 10 is not relaxed for mail. What is stored is a `kms://` reference, and the material
-- stays in the secret store exactly as a provider's credential does (migration 0035).
--
-- One row, like platform_settings, because a platform sends as itself. A subscriber does not
-- get their own sender: mail that claims to be from a subscriber is mail we cannot sign for,
-- and the first thing a receiving server would do with it is refuse it.

SET LOCAL ROLE nx_migrator;

CREATE TABLE mail_settings (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- `none` is the honest default: a deployment that has not been told how to send mail does
  -- not send it, and messages queue where the console can still show them.
  provider       text NOT NULL DEFAULT 'none' CHECK (provider IN ('none', 'resend', 'http')),
  -- The address every message leaves from, and the name a reader sees beside it.
  from_address   text CHECK (from_address IS NULL OR from_address ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  from_name      text CHECK (from_name IS NULL OR length(from_name) BETWEEN 2 AND 60),
  -- Where a reply goes, when it is not the sender. A platform that sends from a no-reply
  -- address and offers nowhere to reply is a platform nobody can ask a question.
  reply_to       text CHECK (reply_to IS NULL OR reply_to ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  -- Where the service this deployment posts to lives. Null for `resend`, which has one.
  endpoint       text CHECK (endpoint IS NULL OR endpoint LIKE 'https://%'),
  -- The reference the secret store holds the key under. A pointer, never the material.
  credential_ref text,
  -- What the last send attempt did, so the panel can say «it works» without anybody guessing.
  last_sent_at   timestamptz,
  last_error     text CHECK (last_error IS NULL OR length(last_error) <= 300),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  CONSTRAINT ck_mail_credential_ref CHECK (
    credential_ref IS NULL OR credential_ref LIKE 'kms://%'
  ),
  -- Configured means configured: a provider named without an address to send from, or without
  -- a key, would queue messages that can never leave and report success while doing it.
  CONSTRAINT ck_mail_configured CHECK (
    provider = 'none'
    OR (from_address IS NOT NULL AND credential_ref IS NOT NULL)
  ),
  -- A service this deployment posts to needs an address. Resend has its own.
  CONSTRAINT ck_mail_endpoint CHECK (provider <> 'http' OR endpoint IS NOT NULL)
);

COMMENT ON TABLE mail_settings IS
  'How mail leaves this deployment. One row: a platform sends as itself. The key is a kms:// reference, never the material (rule 10).';
COMMENT ON COLUMN mail_settings.credential_ref IS
  'Where the secret store holds the key. The panel writes the key to the store and only this pointer here.';

INSERT INTO mail_settings (id) VALUES (true);

REVOKE ALL ON mail_settings FROM PUBLIC;
-- The worker reads it to build a transport, and writes back what the last attempt did.
GRANT SELECT, UPDATE (last_sent_at, last_error) ON mail_settings TO nx_app;
GRANT SELECT, UPDATE ON mail_settings TO nx_operator;

RESET ROLE;
