-- Add full-text search index on Message.content for efficient message search.
-- Uses PostgreSQL GIN index with tsvector for case-insensitive full-text search.
-- Falls back to ILIKE if the index is not available.

CREATE INDEX IF NOT EXISTS "Message_content_search_idx"
  ON "Message" USING gin(to_tsvector('english', content));
