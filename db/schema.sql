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

-- Demo account flag
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT false;

-- Shared access: a user with cellar_owner_id set logs in with their own
-- credentials but reads and writes the owner's cellar.
ALTER TABLE users ADD COLUMN IF NOT EXISTS cellar_owner_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_users_cellar_owner ON users(cellar_owner_id);

-- Pending invitations to become a member of an owner's cellar. The invitee
-- opens /invite/<token>, sets their own password, and becomes a member.
CREATE TABLE IF NOT EXISTS cellar_invites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  token         TEXT UNIQUE NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  accepted_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cellar_invites_owner ON cellar_invites(owner_id);

-- Bottle photos stored server-side (referenced as /api/images/i/<id>)
CREATE TABLE IF NOT EXISTS user_images (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime          TEXT NOT NULL DEFAULT 'image/jpeg',
  data          BYTEA NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bottles_user ON bottles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_images_user ON user_images(user_id);
CREATE INDEX IF NOT EXISTS idx_tastings_user ON tastings(user_id);
CREATE INDEX IF NOT EXISTS idx_finds_user ON finds(user_id);
