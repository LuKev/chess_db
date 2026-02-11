ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS strict_duplicate_mode BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS duplicate_by_moves INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_by_canonical INTEGER NOT NULL DEFAULT 0;

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS canonical_pgn_hash TEXT,
  ADD COLUMN IF NOT EXISTS white_elo INTEGER,
  ADD COLUMN IF NOT EXISTS black_elo INTEGER;

CREATE INDEX IF NOT EXISTS games_user_canonical_hash_idx
ON games (user_id, canonical_pgn_hash);

CREATE TABLE IF NOT EXISTS game_positions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply INTEGER NOT NULL CHECK (ply >= 0),
  fen_norm TEXT NOT NULL,
  stm CHAR(1) NOT NULL CHECK (stm IN ('w', 'b')),
  castling TEXT NOT NULL,
  ep_square TEXT,
  halfmove INTEGER NOT NULL CHECK (halfmove >= 0),
  fullmove INTEGER NOT NULL CHECK (fullmove >= 1),
  material_key TEXT NOT NULL,
  next_move_uci TEXT,
  next_fen_norm TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, game_id, ply)
);

CREATE INDEX IF NOT EXISTS game_positions_user_fen_idx
ON game_positions (user_id, fen_norm);

CREATE INDEX IF NOT EXISTS game_positions_user_material_idx
ON game_positions (user_id, material_key);

CREATE INDEX IF NOT EXISTS game_positions_user_game_ply_idx
ON game_positions (user_id, game_id, ply);

CREATE INDEX IF NOT EXISTS game_positions_user_next_fen_idx
ON game_positions (user_id, next_fen_norm);

CREATE TABLE IF NOT EXISTS opening_stats (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_fen_norm TEXT NOT NULL,
  move_uci TEXT NOT NULL,
  next_fen_norm TEXT,
  games INTEGER NOT NULL DEFAULT 0,
  white_wins INTEGER NOT NULL DEFAULT 0,
  black_wins INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  avg_elo NUMERIC(8, 2),
  performance NUMERIC(6, 2),
  transpositions INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, position_fen_norm, move_uci)
);

CREATE INDEX IF NOT EXISTS opening_stats_user_position_idx
ON opening_stats (user_id, position_fen_norm);

CREATE INDEX IF NOT EXISTS opening_stats_user_next_fen_idx
ON opening_stats (user_id, next_fen_norm);

CREATE TABLE IF NOT EXISTS engine_lines (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply INTEGER NOT NULL CHECK (ply >= 0),
  fen_norm TEXT NOT NULL,
  engine TEXT NOT NULL,
  depth INTEGER,
  multipv INTEGER,
  pv_uci TEXT[] NOT NULL DEFAULT '{}',
  pv_san TEXT[] NOT NULL DEFAULT '{}',
  eval_cp INTEGER,
  eval_mate INTEGER,
  nodes BIGINT,
  time_ms INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS engine_lines_user_game_ply_idx
ON engine_lines (user_id, game_id, ply, created_at DESC);

CREATE INDEX IF NOT EXISTS engine_lines_user_fen_idx
ON engine_lines (user_id, fen_norm, created_at DESC);

CREATE TABLE IF NOT EXISTS collections (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS collection_games (
  collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection_id, game_id)
);

CREATE INDEX IF NOT EXISTS collection_games_user_game_idx
ON collection_games (user_id, game_id);

CREATE TABLE IF NOT EXISTS tags (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS game_tags (
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  tag_id BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, tag_id)
);

CREATE INDEX IF NOT EXISTS game_tags_user_game_idx
ON game_tags (user_id, game_id);

CREATE INDEX IF NOT EXISTS game_tags_user_tag_idx
ON game_tags (user_id, tag_id);

ALTER TABLE user_annotations
  ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS move_notes JSONB NOT NULL DEFAULT '{}'::jsonb;
