SET LOCAL ROLE nx_migrator;

DROP FUNCTION IF EXISTS app.resolve_profile_share(bytea);
REVOKE ALL ON profile_shares FROM nx_app, nx_retention, nx_auth;
DROP TABLE IF EXISTS profile_shares;
