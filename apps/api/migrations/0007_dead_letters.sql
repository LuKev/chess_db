CREATE TABLE IF NOT EXISTS queue_dead_letters (
  id BIGSERIAL PRIMARY KEY,
  queue_name TEXT NOT NULL,
  job_name TEXT NOT NULL,
  job_id TEXT,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts_made INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  failed_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS queue_dead_letters_created_at_idx
ON queue_dead_letters (created_at DESC);

CREATE INDEX IF NOT EXISTS queue_dead_letters_user_created_at_idx
ON queue_dead_letters (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS queue_dead_letters_queue_created_at_idx
ON queue_dead_letters (queue_name, created_at DESC);
