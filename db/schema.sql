CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT,
  openai_key    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bottles (
  id            TEXT NOT NULL,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data          JSONB NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS tastings (
  id            TEXT NOT NULL,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data          JSONB NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS finds (
  id            TEXT NOT NULL,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data          JSONB NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, user_id)
);

-- Share settings
ALTER TABLE users ADD COLUMN IF NOT EXISTS share_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS share_show_values BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bottles_user ON bottles(user_id);
CREATE INDEX IF NOT EXISTS idx_tastings_user ON tastings(user_id);
CREATE INDEX IF NOT EXISTS idx_finds_user ON finds(user_id);
