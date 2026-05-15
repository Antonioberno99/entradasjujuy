ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS mp_user_id TEXT,
  ADD COLUMN IF NOT EXISTS mp_access_token TEXT,
  ADD COLUMN IF NOT EXISTS mp_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS mp_public_key TEXT,
  ADD COLUMN IF NOT EXISTS mp_scope TEXT,
  ADD COLUMN IF NOT EXISTS mp_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mp_connected_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_usuarios_mp_user_id ON usuarios(mp_user_id);
