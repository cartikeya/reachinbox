CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  google_id VARCHAR(255) UNIQUE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  avatar_url TEXT,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS senders (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(255),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS slack_connections (
  user_id CHAR(36) PRIMARY KEY,
  team_id VARCHAR(255),
  team_name VARCHAR(255),
  access_token TEXT NOT NULL,
  channel_id VARCHAR(255),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT slack_connections_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS emails (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  sender_email VARCHAR(255) NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  subject TEXT NOT NULL,
  body LONGTEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  scheduled_at DATETIME(3) NOT NULL,
  sent_at DATETIME(3),
  failed_at DATETIME(3),
  error_message TEXT,
  message_id VARCHAR(512),
  ethereal_preview_url TEXT,
  idempotency_key VARCHAR(64) NOT NULL UNIQUE,
  batch_id CHAR(36),
  attempt_count INT NOT NULL DEFAULT 0,
  delay_between_ms INT NOT NULL DEFAULT 2000,
  hourly_limit INT NOT NULL DEFAULT 200,
  last_rate_limit_window VARCHAR(64),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT emails_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX emails_user_status_idx (user_id, status, scheduled_at),
  INDEX emails_recipient_idx (recipient_email),
  INDEX emails_scheduled_idx (status, scheduled_at)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
