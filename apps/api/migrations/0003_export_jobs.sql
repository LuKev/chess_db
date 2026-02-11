CREATE TABLE IF NOT EXISTS export_jobs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  mode TEXT NOT NULL CHECK (mode IN ('ids', 'query')),
  game_ids BIGINT[],
  filter_query JSONB,
  include_annotations BOOLEAN NOT NULL DEFAULT FALSE,
  output_object_key TEXT,
  exported_games INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS export_jobs_user_status_idx
ON export_jobs (user_id, status, created_at DESC);
