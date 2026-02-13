ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS max_games INTEGER;

-- Optional: keep values sane if provided.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'import_jobs_max_games_check'
  ) THEN
    ALTER TABLE import_jobs
      ADD CONSTRAINT import_jobs_max_games_check
      CHECK (max_games IS NULL OR (max_games > 0 AND max_games <= 100000));
  END IF;
END $$;

