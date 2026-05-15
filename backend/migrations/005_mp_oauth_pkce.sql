CREATE TABLE IF NOT EXISTS mp_oauth_states (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mp_oauth_states_user_id ON mp_oauth_states(user_id);
CREATE INDEX IF NOT EXISTS idx_mp_oauth_states_expires_at ON mp_oauth_states(expires_at);

