CREATE TABLE IF NOT EXISTS user_annotations (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  annotations JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, game_id)
);

CREATE TABLE IF NOT EXISTS engine_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  fen TEXT NOT NULL,
  depth INTEGER,
  nodes INTEGER,
  time_ms INTEGER,
  best_move TEXT,
  principal_variation TEXT,
  eval_cp INTEGER,
  eval_mate INTEGER,
  error_message TEXT,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS engine_requests_user_status_idx
ON engine_requests (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS user_annotations_user_game_idx
ON user_annotations (user_id, game_id);
