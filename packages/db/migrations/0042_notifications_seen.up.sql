-- 0042: when each person last looked at their notifications.
--
-- The console gains an inbox, and an inbox needs to know what is new. What it does not
-- need is a second copy of every event: the things worth telling somebody about are
-- already rows here, in change_events, review_cases, run_waits, wallets and
-- profile_shares. Copying them into an inbox table would create two versions of the same
-- fact that drift the first time one of them is written and the other is not.
--
-- So the inbox is assembled from those tables on each read, and the only state it needs
-- is one timestamp per person: what they had already seen. Unread is everything after it.

SET LOCAL ROLE nx_migrator;

ALTER TABLE users ADD COLUMN notifications_seen_at timestamptz;
