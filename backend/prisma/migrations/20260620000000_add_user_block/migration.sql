-- FEAT-S2: Add UserBlock table for block/mute functionality.
-- Allows a user to block another user, preventing blocked users'
-- messages from appearing and stopping them from sending new messages.

CREATE TABLE "UserBlock" (
  "id"        TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "blockerId" TEXT         NOT NULL,
  "blockedId" TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserBlock_pkey"            PRIMARY KEY ("id"),
  CONSTRAINT "UserBlock_blockerId_fkey"  FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "UserBlock_blockedId_fkey"  FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "UserBlock_blocker_blocked_unique" UNIQUE ("blockerId", "blockedId")
);

CREATE INDEX "UserBlock_blockerId_idx" ON "UserBlock"("blockerId");
CREATE INDEX "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");
