-- EntradasJujuy - Email verification for password accounts.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ;

UPDATE usuarios
SET email_verified = true,
    email_verified_at = COALESCE(email_verified_at, NOW())
WHERE auth_provider = 'google'
  AND email_verified IS DISTINCT FROM true;
