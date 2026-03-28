ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS share_token TEXT,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE collections
SET share_token = SUBSTRING(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 24)
WHERE share_token IS NULL;

ALTER TABLE collections
  ALTER COLUMN share_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS collections_share_token_unique
ON collections (share_token);

CREATE TABLE IF NOT EXISTS repertoires (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  orientation TEXT NOT NULL CHECK (orientation IN ('white', 'black', 'either')) DEFAULT 'either',
  color TEXT,
  share_token TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name),
  UNIQUE (share_token)
);

CREATE TABLE IF NOT EXISTS repertoire_entries (
  id BIGSERIAL PRIMARY KEY,
  repertoire_id BIGINT NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_entry_id BIGINT REFERENCES repertoire_entries(id) ON DELETE CASCADE,
  position_fen TEXT NOT NULL,
  fen_norm TEXT NOT NULL,
  move_uci TEXT NOT NULL,
  move_san TEXT,
  next_fen TEXT,
  next_fen_norm TEXT,
  note TEXT,
  practice_count INTEGER NOT NULL DEFAULT 0 CHECK (practice_count >= 0),
  correct_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  last_drilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS repertoire_entries_repertoire_idx
ON repertoire_entries (repertoire_id, parent_entry_id, created_at ASC);

CREATE INDEX IF NOT EXISTS repertoire_entries_fen_idx
ON repertoire_entries (user_id, fen_norm, repertoire_id);

CREATE TABLE IF NOT EXISTS auto_annotation_jobs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  engine TEXT NOT NULL DEFAULT 'stockfish',
  depth INTEGER,
  time_ms INTEGER,
  processed_plies INTEGER NOT NULL DEFAULT 0 CHECK (processed_plies >= 0),
  annotated_plies INTEGER NOT NULL DEFAULT 0 CHECK (annotated_plies >= 0),
  overwrite_existing BOOLEAN NOT NULL DEFAULT FALSE,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auto_annotation_jobs_user_status_idx
ON auto_annotation_jobs (user_id, status, created_at DESC);
