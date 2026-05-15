-- EntradasJujuy - Auth password + Google
-- Ejecutar sobre bases existentes antes de usar /api/auth/google.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) DEFAULT 'password',
  ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
