-- Add edit/delete support to Message table
-- editedAt: set when the sender edits a message (null = never edited)
-- isDeleted: soft delete flag (content replaced with tombstone on frontend)
-- deletedAt: timestamp when the message was soft-deleted

ALTER TABLE "Message"
  ADD COLUMN "editedAt"  TIMESTAMP(3),
  ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "deletedAt" TIMESTAMP(3);
