import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { v4 as uuid } from 'uuid';
import { config } from './config.js';
import type { EmailRecord, EmailStatus, Sender, User } from './types.js';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const migrationPath = path.join(rootDir, 'migrations/001_init.sql');

export async function migrate() {
  const sql = await fs.readFile(migrationPath, 'utf8');
  await pool.query(sql);
}

export async function seed() {
  await migrate();
  const senders = [...new Set([config.defaultSender, ...config.senderEmails])];
  for (const email of senders) {
    await pool.query(
      `INSERT INTO senders (id, email, display_name) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET active = TRUE`,
      [uuid(), email, email.split('@')[0]],
    );
  }
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const mapUser = (row: QueryResultRow): User => ({
  id: row.id,
  googleId: row.google_id,
  name: row.name,
  email: row.email,
  avatarUrl: row.avatar_url,
});

const mapEmail = (row: QueryResultRow): EmailRecord => ({
  id: row.id,
  userId: row.user_id,
  senderEmail: row.sender_email,
  recipientEmail: row.recipient_email,
  subject: row.subject,
  body: row.body,
  status: row.status,
  scheduledAt: new Date(row.scheduled_at).toISOString(),
  sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
  failedAt: row.failed_at ? new Date(row.failed_at).toISOString() : null,
  errorMessage: row.error_message,
  messageId: row.message_id,
  etherealPreviewUrl: row.ethereal_preview_url,
  idempotencyKey: row.idempotency_key,
  batchId: row.batch_id,
  attemptCount: row.attempt_count,
  delayBetweenMs: row.delay_between_ms,
  hourlyLimit: row.hourly_limit,
  lastRateLimitWindow: row.last_rate_limit_window,
  createdAt: new Date(row.created_at).toISOString(),
});

export async function upsertUser(input: { googleId?: string; name: string; email: string; avatarUrl?: string }) {
  const result = await pool.query(
    `INSERT INTO users (id, google_id, name, email, avatar_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET google_id = COALESCE(EXCLUDED.google_id, users.google_id), name = EXCLUDED.name,
       avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url), updated_at = NOW()
     RETURNING *`,
    [uuid(), input.googleId ?? null, input.name, input.email, input.avatarUrl ?? null],
  );
  return mapUser(result.rows[0]);
}

export async function getUserById(id: string) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function getUserByGoogleId(googleId: string) {
  const result = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function listSenders(): Promise<Sender[]> {
  const result = await pool.query('SELECT id, email, display_name, active FROM senders WHERE active = TRUE ORDER BY email');
  return result.rows.map((row) => ({ id: row.id, email: row.email, displayName: row.display_name, active: row.active }));
}

export async function ensureSender(email: string) {
  await pool.query(
    `INSERT INTO senders (id, email, display_name) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET active = TRUE`,
    [uuid(), email, email.split('@')[0]],
  );
}

export async function insertEmails(input: {
  userId: string;
  batchId: string;
  rows: Array<{ recipientEmail: string; senderEmail: string; subject: string; body: string; scheduledAt: string; delayBetweenMs: number; hourlyLimit: number }>;
}) {
  return withTransaction(async (client) => {
    const records: EmailRecord[] = [];
    for (const row of input.rows) {
      const id = uuid();
      const idempotencyKey = crypto.createHash('sha256').update(JSON.stringify([input.userId, row.recipientEmail.toLowerCase(), row.senderEmail, row.subject, row.body, row.scheduledAt])).digest('hex');
      const result = await client.query(
        `INSERT INTO emails (id, user_id, sender_email, recipient_email, subject, body, scheduled_at, idempotency_key, batch_id, delay_between_ms, hourly_limit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
        [id, input.userId, row.senderEmail, row.recipientEmail, row.subject, row.body, row.scheduledAt, idempotencyKey, input.batchId, row.delayBetweenMs, row.hourlyLimit],
      );
      if (result.rows[0]) records.push(mapEmail(result.rows[0]));
    }
    return records;
  });
}

export async function listEmails(userId: string, status: EmailStatus, query?: string) {
  const params: unknown[] = [userId, status];
  const where = ['user_id = $1', 'status = $2'];
  if (query) {
    params.push(`%${query}%`);
    where.push(`(recipient_email ILIKE $${params.length} OR subject ILIKE $${params.length} OR body ILIKE $${params.length})`);
  }
  const result = await pool.query(`SELECT * FROM emails WHERE ${where.join(' AND ')} ORDER BY scheduled_at DESC LIMIT 500`, params);
  return result.rows.map(mapEmail);
}

export async function getEmail(id: string) {
  const result = await pool.query('SELECT * FROM emails WHERE id = $1', [id]);
  return result.rows[0] ? mapEmail(result.rows[0]) : null;
}

export async function claimEmail(id: string) {
  const result = await pool.query(
    `UPDATE emails SET status = 'sending', attempt_count = attempt_count + 1, updated_at = NOW()
     WHERE id = $1 AND status = 'scheduled' RETURNING *`,
    [id],
  );
  return result.rows[0] ? mapEmail(result.rows[0]) : null;
}

export async function deferEmail(id: string, scheduledAt: Date, window?: string) {
  const result = await pool.query(
    `UPDATE emails SET status = 'scheduled', scheduled_at = $2, attempt_count = attempt_count + 1, last_rate_limit_window = COALESCE($3, last_rate_limit_window), updated_at = NOW()
     WHERE id = $1 AND status = 'sending' RETURNING *`,
    [id, scheduledAt, window ?? null],
  );
  return result.rows[0] ? mapEmail(result.rows[0]) : null;
}

export async function markSent(id: string, messageId: string, previewUrl?: string) {
  const result = await pool.query(
    `UPDATE emails SET status = 'sent', sent_at = NOW(), message_id = $2, ethereal_preview_url = $3, error_message = NULL, updated_at = NOW()
     WHERE id = $1 AND status = 'sending' RETURNING *`,
    [id, messageId, previewUrl ?? null],
  );
  return result.rows[0] ? mapEmail(result.rows[0]) : null;
}

export async function markFailed(id: string, errorMessage: string) {
  const result = await pool.query(
    `UPDATE emails SET status = 'failed', failed_at = NOW(), error_message = $2, updated_at = NOW()
     WHERE id = $1 AND status = 'sending' RETURNING *`,
    [id, errorMessage.slice(0, 1000)],
  );
  return result.rows[0] ? mapEmail(result.rows[0]) : null;
}

export async function recoverStaleEmails(staleBefore: Date) {
  await pool.query(
    `UPDATE emails SET status = 'scheduled', updated_at = NOW(), error_message = NULL
     WHERE status = 'sending' AND updated_at < $1`,
    [staleBefore],
  );
}

export async function listFutureScheduledEmails() {
  const result = await pool.query(`SELECT * FROM emails WHERE status = 'scheduled' ORDER BY scheduled_at ASC LIMIT 5000`);
  return result.rows.map(mapEmail);
}

export async function saveSlackConnection(input: { userId: string; teamId?: string; teamName?: string; accessToken: string; channelId?: string }) {
  await pool.query(
    `INSERT INTO slack_connections (user_id, team_id, team_name, access_token, channel_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET team_id = EXCLUDED.team_id, team_name = EXCLUDED.team_name, access_token = EXCLUDED.access_token, channel_id = EXCLUDED.channel_id, updated_at = NOW()`,
    [input.userId, input.teamId ?? null, input.teamName ?? null, input.accessToken, input.channelId ?? null],
  );
}

export async function getSlackConnection(userId: string) {
  const result = await pool.query('SELECT * FROM slack_connections WHERE user_id = $1', [userId]);
  return result.rows[0] ?? null;
}

export async function disconnectSlack(userId: string) {
  await pool.query('DELETE FROM slack_connections WHERE user_id = $1', [userId]);
}

export async function getOverview(userId: string) {
  const result = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
            COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
            MIN(scheduled_at) FILTER (WHERE status = 'scheduled') AS next_scheduled
     FROM emails WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0];
}

if (process.argv.includes('--migrate')) {
  migrate().then(() => pool.end()).then(() => console.log('Migration complete.')).catch((error) => { console.error(error); process.exitCode = 1; });
}
if (process.argv.includes('--seed')) {
  seed().then(() => pool.end()).then(() => console.log('Seed complete.')).catch((error) => { console.error(error); process.exitCode = 1; });
}
