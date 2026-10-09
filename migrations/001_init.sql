CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  google_id TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS senders (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS slack_connections (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  team_id TEXT,
  team_name TEXT,
  access_token TEXT NOT NULL,
  channel_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS emails (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_email TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'sending', 'sent', 'failed')) DEFAULT 'scheduled',
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error_message TEXT,
  message_id TEXT,
  ethereal_preview_url TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  batch_id UUID,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  delay_between_ms INTEGER NOT NULL DEFAULT 2000,
  hourly_limit INTEGER NOT NULL DEFAULT 200,
  last_rate_limit_window TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS emails_user_status_idx ON emails(user_id, status, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS emails_recipient_idx ON emails(recipient_email);
CREATE INDEX IF NOT EXISTS emails_scheduled_idx ON emails(status, scheduled_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
