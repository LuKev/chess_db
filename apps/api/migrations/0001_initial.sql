CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'partial')),
  source_object_key TEXT,
  total_games INTEGER NOT NULL DEFAULT 0,
  inserted_games INTEGER NOT NULL DEFAULT 0,
  duplicate_games INTEGER NOT NULL DEFAULT 0,
  parse_errors INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS games (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT,
  license TEXT,
  import_job_id BIGINT REFERENCES import_jobs(id) ON DELETE SET NULL,
  white TEXT NOT NULL,
  white_norm TEXT NOT NULL,
  black TEXT NOT NULL,
  black_norm TEXT NOT NULL,
  eco TEXT,
  event TEXT,
  event_norm TEXT,
  site TEXT,
  played_on DATE,
  result TEXT NOT NULL DEFAULT '*',
  time_control TEXT,
  rated BOOLEAN,
  ply_count INTEGER,
  starting_fen TEXT,
  moves_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_pgn (
  game_id BIGINT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  pgn_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_moves (
  game_id BIGINT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  move_tree JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS import_errors (
  id BIGSERIAL PRIMARY KEY,
  import_job_id BIGINT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  line_number INTEGER,
  game_offset INTEGER,
  error_message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_filters (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filter_query JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS games_user_date_idx ON games(user_id, played_on DESC);
CREATE INDEX IF NOT EXISTS games_user_white_norm_idx ON games(user_id, white_norm);
CREATE INDEX IF NOT EXISTS games_user_black_norm_idx ON games(user_id, black_norm);
CREATE INDEX IF NOT EXISTS games_user_eco_idx ON games(user_id, eco);
CREATE INDEX IF NOT EXISTS games_user_result_idx ON games(user_id, result);
CREATE INDEX IF NOT EXISTS games_user_time_control_idx ON games(user_id, time_control);
CREATE INDEX IF NOT EXISTS games_user_event_norm_idx ON games(user_id, event_norm);
CREATE INDEX IF NOT EXISTS games_user_moves_hash_idx ON games(user_id, moves_hash);

CREATE UNIQUE INDEX IF NOT EXISTS games_user_moves_hash_date_unique
ON games (user_id, moves_hash, COALESCE(played_on, DATE '0001-01-01'));
