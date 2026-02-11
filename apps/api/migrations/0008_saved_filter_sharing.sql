ALTER TABLE saved_filters
  ADD COLUMN IF NOT EXISTS share_token TEXT;

UPDATE saved_filters
SET share_token = substring(md5(random()::text || clock_timestamp()::text), 1, 24)
WHERE share_token IS NULL;

ALTER TABLE saved_filters
  ALTER COLUMN share_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS saved_filters_share_token_unique
ON saved_filters (share_token);
