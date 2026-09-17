SET LOCAL ROLE nx_migrator;

ALTER TABLE notification_channels
  DROP CONSTRAINT ck_channel_proof_settled;

ALTER TABLE notification_channels
  DROP COLUMN proof_hash,
  DROP COLUMN proof_attempts,
  DROP COLUMN proof_expires_at,
  DROP COLUMN proof_sent_at;

RESET ROLE;
