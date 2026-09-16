SET LOCAL ROLE nx_migrator;

ALTER TABLE platform_settings DROP COLUMN IF EXISTS user_second_step;

DROP TABLE IF EXISTS user_login_codes;
