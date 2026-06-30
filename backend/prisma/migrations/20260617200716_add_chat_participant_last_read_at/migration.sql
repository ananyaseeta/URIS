-- Add lastReadAt to ChatParticipant for unread message tracking
-- This nullable timestamp records when each participant last read a chat.
-- Unread count = messages in chat created after lastReadAt (or all if null).

ALTER TABLE "ChatParticipant" ADD COLUMN "lastReadAt" TIMESTAMP(3);
