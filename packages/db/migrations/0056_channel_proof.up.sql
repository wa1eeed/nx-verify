-- 0056: proving that an address belongs to whoever typed it.
--
-- `notification_channels.verified_at` has been the gate since 0023: nothing is delivered to
-- an address that has not been proved, and the queue reads only rows where it is set. What
-- was missing is any way to set it. `verifyChannel` existed and was called from tests alone,
-- so a subscriber could not subscribe to anything at all, and the screen listing their
-- addresses was a screen with no way to add one.
--
-- The proof is a code mailed to the address, which is the only thing that actually
-- establishes the claim: whoever can read that mailbox asked for this. It is held here
-- rather than in a table of its own because there is exactly one pending proof per address
-- and the row already exists, and a one to one table would have to be kept in step by hand.
--
-- Shaped like every other code in this platform (ADR-143): the digits are never stored, only
-- a digest salted with the address, so the same six digits for two addresses are two
-- different digests and a stolen table cannot be searched for a known code.

SET LOCAL ROLE nx_migrator;

ALTER TABLE notification_channels
  ADD COLUMN proof_hash bytea
    CHECK (proof_hash IS NULL OR octet_length(proof_hash) = 32),
  -- Five guesses, like a sign in. Six digits guessed five times is one chance in two
  -- hundred thousand, and the proof is dead after that whatever the clock says.
  ADD COLUMN proof_attempts int NOT NULL DEFAULT 0 CHECK (proof_attempts >= 0),
  ADD COLUMN proof_expires_at timestamptz,
  -- When the last code left, so a button on a screen cannot be turned into a way to send
  -- mail to an address somebody else owns.
  ADD COLUMN proof_sent_at timestamptz;

COMMENT ON COLUMN notification_channels.proof_hash IS
  'Digest of the code mailed to this address, salted with the address. Never the code. Cleared once the address is proved.';

-- A proved address keeps no pending proof: the two states are exclusive, and a row that is
-- both is a bug worth failing on rather than reasoning about.
ALTER TABLE notification_channels
  ADD CONSTRAINT ck_channel_proof_settled
    CHECK (verified_at IS NULL OR proof_hash IS NULL);

COMMENT ON CONSTRAINT ck_channel_proof_settled ON notification_channels IS
  'An address is either waiting to be proved or already proved, never both.';

RESET ROLE;
