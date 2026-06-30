-- MED-5: Drop the dead Message.readAt column.
--
-- This field was never written by any application code. Unread counting is
-- handled exclusively via ChatParticipant.lastReadAt. The column adds noise
-- to the schema and wastes one nullable DateTime column per message row.
--
-- Safe to drop: grep across the entire codebase confirms zero writes or reads
-- of Message.readAt in controllers, services, routes, or frontend code.

ALTER TABLE "Message" DROP COLUMN IF EXISTS "readAt";
