ALTER TABLE engine_requests
  ADD COLUMN IF NOT EXISTS engine TEXT NOT NULL DEFAULT 'stockfish',
  ADD COLUMN IF NOT EXISTS multipv INTEGER NOT NULL DEFAULT 1 CHECK (multipv >= 1 AND multipv <= 20),
  ADD COLUMN IF NOT EXISTS result_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS game_id BIGINT REFERENCES games(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ply INTEGER CHECK (ply >= 0),
  ADD COLUMN IF NOT EXISTS auto_store BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS engine_requests_user_fen_engine_idx
ON engine_requests (user_id, engine, created_at DESC);

CREATE TABLE IF NOT EXISTS game_analysis_jobs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  engine TEXT NOT NULL DEFAULT 'stockfish',
  depth INTEGER,
  nodes INTEGER,
  time_ms INTEGER,
  multipv INTEGER NOT NULL DEFAULT 1 CHECK (multipv >= 1 AND multipv <= 20),
  start_ply INTEGER NOT NULL DEFAULT 0 CHECK (start_ply >= 0),
  end_ply INTEGER CHECK (end_ply >= 0),
  processed_positions INTEGER NOT NULL DEFAULT 0 CHECK (processed_positions >= 0),
  stored_lines INTEGER NOT NULL DEFAULT 0 CHECK (stored_lines >= 0),
  error_message TEXT,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS game_analysis_jobs_user_status_idx
ON game_analysis_jobs (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS game_analysis_jobs_user_game_idx
ON game_analysis_jobs (user_id, game_id, created_at DESC);
