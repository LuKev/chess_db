ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS position_index_status TEXT NOT NULL DEFAULT 'not_indexed',
  ADD COLUMN IF NOT EXISTS position_index_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS position_index_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS position_index_error TEXT,
  ADD COLUMN IF NOT EXISTS opening_index_status TEXT NOT NULL DEFAULT 'not_indexed',
  ADD COLUMN IF NOT EXISTS opening_index_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opening_index_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opening_index_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'import_jobs_position_index_status_check'
  ) THEN
    ALTER TABLE import_jobs
      ADD CONSTRAINT import_jobs_position_index_status_check
      CHECK (position_index_status IN ('not_indexed', 'queued', 'running', 'indexed', 'failed', 'skipped'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'import_jobs_opening_index_status_check'
  ) THEN
    ALTER TABLE import_jobs
      ADD CONSTRAINT import_jobs_opening_index_status_check
      CHECK (opening_index_status IN ('not_indexed', 'queued', 'running', 'indexed', 'failed', 'skipped'));
  END IF;
END $$;

UPDATE import_jobs
SET
  position_index_status = CASE
    WHEN status IN ('completed', 'partial') AND inserted_games > 0 THEN 'indexed'
    WHEN status IN ('completed', 'partial') THEN 'skipped'
    ELSE position_index_status
  END,
  position_index_completed_at = CASE
    WHEN status IN ('completed', 'partial') AND inserted_games > 0 AND position_index_completed_at IS NULL THEN updated_at
    ELSE position_index_completed_at
  END,
  opening_index_status = CASE
    WHEN status IN ('completed', 'partial') AND inserted_games > 0 THEN 'indexed'
    WHEN status IN ('completed', 'partial') THEN 'skipped'
    ELSE opening_index_status
  END,
  opening_index_completed_at = CASE
    WHEN status IN ('completed', 'partial') AND inserted_games > 0 AND opening_index_completed_at IS NULL THEN updated_at
    ELSE opening_index_completed_at
  END
WHERE position_index_status = 'not_indexed'
   OR opening_index_status = 'not_indexed';

CREATE TABLE IF NOT EXISTS user_index_status (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  position_status TEXT NOT NULL DEFAULT 'not_indexed',
  position_last_requested_at TIMESTAMPTZ,
  position_last_completed_at TIMESTAMPTZ,
  position_last_error TEXT,
  position_indexed_games INTEGER NOT NULL DEFAULT 0,
  opening_status TEXT NOT NULL DEFAULT 'not_indexed',
  opening_last_requested_at TIMESTAMPTZ,
  opening_last_completed_at TIMESTAMPTZ,
  opening_last_error TEXT,
  opening_indexed_games INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_index_status_position_status_check'
  ) THEN
    ALTER TABLE user_index_status
      ADD CONSTRAINT user_index_status_position_status_check
      CHECK (position_status IN ('not_indexed', 'queued', 'running', 'indexed', 'failed', 'skipped'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_index_status_opening_status_check'
  ) THEN
    ALTER TABLE user_index_status
      ADD CONSTRAINT user_index_status_opening_status_check
      CHECK (opening_status IN ('not_indexed', 'queued', 'running', 'indexed', 'failed', 'skipped'));
  END IF;
END $$;
