SET LOCAL ROLE nx_migrator;

ALTER TABLE users DROP COLUMN IF EXISTS notifications_seen_at;
