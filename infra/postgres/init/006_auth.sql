-- Identitas pengguna dashboard (auth/session). Password disimpan sebagai
-- hash scrypt (format: scrypt$<salt_b64url>$<hash_b64url>). JWT untuk sesi
-- ditandatangani dengan JWT_SECRET (HS256) di apps/api.
CREATE TABLE IF NOT EXISTS app_user (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           VARCHAR(200) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  name            VARCHAR(200),
  role            VARCHAR(20) NOT NULL DEFAULT 'user',  -- admin, user
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
