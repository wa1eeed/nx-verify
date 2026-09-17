-- 0059: a subscriber switching an add-on on for themselves.
--
-- `tenant_modules` was granted SELECT to the application role and write to the operator's,
-- because a module was a commercial decision made in the panel. Self service registration
-- changes who makes it: a company that has just signed itself up picks its own services on
-- the welcome screen, and there is no member of staff in that conversation (ADR-154).
--
-- Safe to allow, because switching a module on costs nothing. It decides which sections a
-- customer file draws and which products a call may use, and every one of those spends from a
-- wallet an operator still has to fund. Turning everything on with no balance buys nothing.
--
-- Row level security already applies: the policy from 0051 is unchanged, so a workspace can
-- only ever write its own row.

SET LOCAL ROLE nx_migrator;

GRANT INSERT, UPDATE, DELETE ON tenant_modules TO nx_app;

RESET ROLE;
