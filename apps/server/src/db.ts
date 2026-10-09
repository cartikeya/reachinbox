import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import mysql, { type PoolConnection, type ResultSetHeader } from 'mysql2/promise';
import { v4 as uuid } from 'uuid';
import { config } from './config.js';
import type { EmailRecord, EmailStatus, Sender, User } from './types.js';

type DbRow = Record<string, any>;
type QueryRunner = { query: (sql: string, values?: unknown[]) => Promise<any> };

const databaseUrl = new URL(config.databaseUrl);
const localHosts = new Set(['localhost', '127.0.0.1', 'mysql']);
const useTls = config.databaseSsl === 'true' || (config.databaseSsl !== 'false' && !localHosts.has(databaseUrl.hostname));

export const pool = mysql.createPool({
  host: databaseUrl.hostname,
  port: Number(databaseUrl.port || 3306),
  user: decodeURIComponent(databaseUrl.username),
  password: decodeURIComponent(databaseUrl.password),
  database: decodeURIComponent(databaseUrl.pathname.replace(/^\//, '')),
  waitForConnections: true,
  connectionLimit: 12,
  queueLimit: 0,
  multipleStatements: true,
  ssl: useTls ? { rejectUnauthorized: false } : undefined,
});

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const migrationPath = path.join(rootDir, 'migrations/001_init.sql');

const queryRows = async <T extends DbRow = DbRow>(runner: QueryRunner, sql: string, values: unknown[] = []) => {
  const [rows] = await runner.query(sql, values);
  return rows as T[];
};

const queryOne = async <T extends DbRow = DbRow>(runner: QueryRunner, sql: string, values: unknown[] = []) => {
  const rows = await queryRows<T>(runner, sql, values);
  return rows[0] ?? null;
};

const iso = (value: unknown) => value ? new Date(value as string | number | Date).toISOString() : null;

export async function migrate() {
  const sql = await fs.readFile(migrationPath, 'utf8');
  await pool.query(sql);
}

export async function seed() {
  await migrate();
  const senders = [...new Set([config.defaultSender, ...config.senderEmails])];
  for (const email of senders) {
    await pool.query(
      `INSERT INTO senders (id, email, display_name) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE active = TRUE`,
      [uuid(), email, email.split('@')[0]],
    );
  }
}

export async function withTransaction<T>(fn: (client: PoolConnection) => Promise<T>) {
  const client = await pool.getConnection();
  try {
    await client.beginTransaction();
    const result = await fn(client);
    await client.commit();
    return result;
  } catch (error) {
    await client.rollback();
    throw error;
  } finally {
    client.release();
  }
}

const mapUser = (row: DbRow): User => ({
  id: row.id,
  googleId: row.google_id,
  name: row.name,
  email: row.email,
  avatarUrl: row.avatar_url,
});

const mapEmail = (row: DbRow): EmailRecord => ({
  id: row.id,
  userId: row.user_id,
  senderEmail: row.sender_email,
  recipientEmail: row.recipient_email,
  subject: row.subject,
  body: row.body,
  status: row.status,
  scheduledAt: iso(row.scheduled_at)!,
  sentAt: iso(row.sent_at),
  failedAt: iso(row.failed_at),
  errorMessage: row.error_message,
  messageId: row.message_id,
  etherealPreviewUrl: row.ethereal_preview_url,
  idempotencyKey: row.idempotency_key,
  batchId: row.batch_id,
  attemptCount: Number(row.attempt_count),
  delayBetweenMs: Number(row.delay_between_ms),
  hourlyLimit: Number(row.hourly_limit),
  lastRateLimitWindow: row.last_rate_limit_window,
  createdAt: iso(row.created_at)!,
});

export async function upsertUser(input: { googleId?: string; name: string; email: string; avatarUrl?: string }) {
  await pool.query(
    `INSERT INTO users (id, google_id, name, email, avatar_url)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE google_id = COALESCE(VALUES(google_id), google_id), name = VALUES(name),
       avatar_url = COALESCE(VALUES(avatar_url), avatar_url), updated_at = CURRENT_TIMESTAMP(3)`,
    [uuid(), input.googleId ?? null, input.name, input.email, input.avatarUrl ?? null],
  );
  return mapUser((await queryOne(pool, 'SELECT * FROM users WHERE email = ?', [input.email]))!);
}

export async function getUserById(id: string) {
  const row = await queryOne(pool, 'SELECT * FROM users WHERE id = ?', [id]);
  return row ? mapUser(row) : null;
}

export async function getUserByGoogleId(googleId: string) {
  const row = await queryOne(pool, 'SELECT * FROM users WHERE google_id = ?', [googleId]);
  return row ? mapUser(row) : null;
}

export async function listSenders(): Promise<Sender[]> {
  const rows = await queryRows(pool, 'SELECT id, email, display_name, active FROM senders WHERE active = TRUE ORDER BY email');
  return rows.map((row) => ({ id: row.id, email: row.email, displayName: row.display_name, active: Boolean(row.active) }));
}

export async function ensureSender(email: string) {
  await pool.query(
    `INSERT INTO senders (id, email, display_name) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE active = TRUE`,
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
      const [result] = await client.query<ResultSetHeader>(
        `INSERT INTO emails (id, user_id, sender_email, recipient_email, subject, body, scheduled_at, idempotency_key, batch_id, delay_between_ms, hourly_limit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [id, input.userId, row.senderEmail, row.recipientEmail, row.subject, row.body, row.scheduledAt, idempotencyKey, input.batchId, row.delayBetweenMs, row.hourlyLimit],
      );
      if (result.affectedRows === 1) {
        const inserted = await queryOne(client, 'SELECT * FROM emails WHERE id = ?', [id]);
        if (inserted) records.push(mapEmail(inserted));
      }
    }
    return records;
  });
}

export async function listEmails(userId: string, status: EmailStatus, query?: string) {
  const params: unknown[] = [userId, status];
  const where = ['user_id = ?', 'status = ?'];
  if (query) {
    params.push(`%${query}%`);
    where.push(`(recipient_email LIKE ? OR subject LIKE ? OR body LIKE ?)`);
    params.push(`%${query}%`, `%${query}%`);
  }
  const rows = await queryRows(pool, `SELECT * FROM emails WHERE ${where.join(' AND ')} ORDER BY scheduled_at DESC LIMIT 500`, params);
  return rows.map(mapEmail);
}

export async function getEmail(id: string) {
  const row = await queryOne(pool, 'SELECT * FROM emails WHERE id = ?', [id]);
  return row ? mapEmail(row) : null;
}

export async function claimEmail(id: string) {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE emails SET status = 'sending', attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = 'scheduled'`,
    [id],
  );
  if (!result.affectedRows) return null;
  const row = await queryOne(pool, 'SELECT * FROM emails WHERE id = ?', [id]);
  return row ? mapEmail(row) : null;
}

export async function deferEmail(id: string, scheduledAt: Date, window?: string) {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE emails SET status = 'scheduled', scheduled_at = ?, attempt_count = attempt_count + 1, last_rate_limit_window = COALESCE(?, last_rate_limit_window), updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = 'sending'`,
    [scheduledAt, window ?? null, id],
  );
  if (!result.affectedRows) return null;
  const row = await queryOne(pool, 'SELECT * FROM emails WHERE id = ?', [id]);
  return row ? mapEmail(row) : null;
}

export async function markSent(id: string, messageId: string, previewUrl?: string) {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE emails SET status = 'sent', sent_at = CURRENT_TIMESTAMP(3), message_id = ?, ethereal_preview_url = ?, error_message = NULL, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = 'sending'`,
    [messageId, previewUrl ?? null, id],
  );
  if (!result.affectedRows) return null;
  const row = await queryOne(pool, 'SELECT * FROM emails WHERE id = ?', [id]);
  return row ? mapEmail(row) : null;
}

export async function markFailed(id: string, errorMessage: string) {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE emails SET status = 'failed', failed_at = CURRENT_TIMESTAMP(3), error_message = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = 'sending'`,
    [errorMessage.slice(0, 1000), id],
  );
  if (!result.affectedRows) return null;
  const row = await queryOne(pool, 'SELECT * FROM emails WHERE id = ?', [id]);
  return row ? mapEmail(row) : null;
}

export async function recoverStaleEmails(staleBefore: Date) {
  await pool.query(
    `UPDATE emails SET status = 'scheduled', updated_at = CURRENT_TIMESTAMP(3), error_message = NULL
     WHERE status = 'sending' AND updated_at < ?`,
    [staleBefore],
  );
}

export async function listFutureScheduledEmails() {
  const rows = await queryRows(pool, `SELECT * FROM emails WHERE status = 'scheduled' ORDER BY scheduled_at ASC LIMIT 5000`);
  return rows.map(mapEmail);
}

export async function saveSlackConnection(input: { userId: string; teamId?: string; teamName?: string; accessToken: string; channelId?: string }) {
  await pool.query(
    `INSERT INTO slack_connections (user_id, team_id, team_name, access_token, channel_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE team_id = VALUES(team_id), team_name = VALUES(team_name), access_token = VALUES(access_token), channel_id = VALUES(channel_id), updated_at = CURRENT_TIMESTAMP(3)`,
    [input.userId, input.teamId ?? null, input.teamName ?? null, input.accessToken, input.channelId ?? null],
  );
}

export async function getSlackConnection(userId: string) {
  return queryOne(pool, 'SELECT * FROM slack_connections WHERE user_id = ?', [userId]);
}

export async function disconnectSlack(userId: string) {
  await pool.query('DELETE FROM slack_connections WHERE user_id = ?', [userId]);
}

export async function getOverview(userId: string) {
  const row = await queryOne(pool,
    `SELECT COALESCE(SUM(status = 'scheduled'), 0) AS scheduled,
            COALESCE(SUM(status = 'sent'), 0) AS sent,
            COALESCE(SUM(status = 'failed'), 0) AS failed,
            MIN(CASE WHEN status = 'scheduled' THEN scheduled_at END) AS next_scheduled
     FROM emails WHERE user_id = ?`,
    [userId],
  );
  return row ? { ...row, scheduled: Number(row.scheduled), sent: Number(row.sent), failed: Number(row.failed) } : { scheduled: 0, sent: 0, failed: 0, next_scheduled: null };
}

if (process.argv.includes('--migrate')) {
  migrate().then(() => pool.end()).then(() => console.log('Migration complete.')).catch((error) => { console.error(error); process.exitCode = 1; });
}
if (process.argv.includes('--seed')) {
  seed().then(() => pool.end()).then(() => console.log('Seed complete.')).catch((error) => { console.error(error); process.exitCode = 1; });
}
