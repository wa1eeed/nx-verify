-- 0041: what the retention role may delete from the tables added since it last changed.
--
-- Units 60 to 65 added four tables, and three of them grow for ever without this.
-- inbound_events gains a row on every provider callback, run_waits keeps every resolved
-- wait, and profile_shares keeps every link that has expired or been withdrawn.
--
-- topup_requests is deliberately absent from this migration and from the job. It is a
-- financial record: what a subscriber asked for, what we confirmed arrived, and the tax
-- invoice it was issued under. Money does not age out of relevance on an operations
-- schedule, and the role that cleans up operational tables must not be able to delete it.
-- The existing grant on that table stays SELECT only.
--
-- run_waits and profile_shares already grant DELETE to nx_retention. inbound_events did
-- not, because it carries no tenant and the retention job was tenant scoped: this is the
-- grant that lets a global sweep clean it.

SET LOCAL ROLE nx_migrator;

-- SELECT as well as DELETE: a delete with a where clause has to read the column it
-- filters on, and a grant that allows the delete but not the read fails at the sweep
-- rather than at the grant.
GRANT SELECT, DELETE ON inbound_events TO nx_retention;
