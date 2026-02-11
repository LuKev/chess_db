ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE engine_requests
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_user_idempotency_key_unique
ON import_jobs (user_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS engine_requests_user_idempotency_key_unique
ON engine_requests (user_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS export_jobs_user_idempotency_key_unique
ON export_jobs (user_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  request_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_events_created_at_idx
ON audit_events (created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_user_created_at_idx
ON audit_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_action_created_at_idx
ON audit_events (action, created_at DESC);
