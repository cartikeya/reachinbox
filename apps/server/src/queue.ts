import { Redis } from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { config } from './config.js';
import { claimEmail, deferEmail, getEmail, listFutureScheduledEmails, markFailed, markSent, recoverStaleEmails } from './db.js';
import { sendEmail } from './mailer.js';
import { indexEmail } from './search.js';
import { notifyRateLimitHit } from './slack.js';
import type { EmailRecord } from './types.js';

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const workerRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
export const emailQueue = new Queue('email-delivery', { connection: redis, defaultJobOptions: { removeOnComplete: { age: 86400, count: 5000 }, removeOnFail: { age: 604800, count: 5000 } } });

const RATE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 7200) end
if tonumber(count) > tonumber(ARGV[1]) then redis.call('DECR', KEYS[1]); return {0, tonumber(ARGV[3]), 'hourly'} end
local last = tonumber(redis.call('GET', KEYS[2]) or '0')
local now = tonumber(ARGV[2])
local minAt = now
if last + tonumber(ARGV[4]) > minAt then minAt = last + tonumber(ARGV[4]) end
if minAt >= tonumber(ARGV[3]) then redis.call('DECR', KEYS[1]); return {0, tonumber(ARGV[3]), 'window'} end
redis.call('SET', KEYS[2], minAt, 'PX', 7200000)
return {1, minAt, 'ok'}
`;

async function reserveSendSlot(senderEmail: string, hourlyLimit: number, minDelayMs: number) {
  const now = Date.now();
  const windowStart = Math.floor(now / 3600000) * 3600000;
  const windowEnd = windowStart + 3600000;
  const keys = [`rate:${senderEmail}:${windowStart}`, `last-send:${senderEmail}`];
  const result = await redis.eval(RATE_SCRIPT, keys.length, ...keys, hourlyLimit, now, windowEnd, minDelayMs) as [number, number, string];
  return { allowed: Number(result[0]) === 1, sendAt: Number(result[1]), reason: result[2], window: new Date(windowStart).toISOString() };
}

export async function scheduleEmailJob(email: EmailRecord, attempt = email.attemptCount) {
  const delay = Math.max(0, new Date(email.scheduledAt).getTime() - Date.now());
  await emailQueue.add('send-email', { emailId: email.id }, { jobId: `email:${email.id}:${attempt}`, delay });
}

async function processEmail(emailId: string) {
  const current = await getEmail(emailId);
  if (!current || current.status !== 'scheduled') return;
  const email = await claimEmail(emailId);
  if (!email) return;
  try {
    const reservation = await reserveSendSlot(email.senderEmail, email.hourlyLimit || config.maxEmailsPerHour, Math.max(email.delayBetweenMs, config.minSendDelayMs));
    if (!reservation.allowed || reservation.sendAt > Date.now() + 50) {
      const nextAt = new Date(Math.max(reservation.sendAt, Date.now() + 250));
      const deferred = await deferEmail(email.id, nextAt, reservation.window);
      if (deferred) {
        await scheduleEmailJob(deferred, deferred.attemptCount);
        if (reservation.reason === 'hourly') {
          await notifyRateLimitHit({ userId: email.userId, senderEmail: email.senderEmail, window: reservation.window, redis });
        }
      }
      return;
    }
    const sent = await sendEmail(email);
    const updated = await markSent(email.id, sent.messageId, sent.previewUrl);
    if (updated) await indexEmail(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown delivery error';
    const failed = await markFailed(email.id, message);
    if (failed) await indexEmail(failed);
    console.error(`Email ${email.id} failed:`, message);
  }
}

let worker: Worker | null = null;
export function startWorker() {
  worker = new Worker('email-delivery', async (job) => processEmail(job.data.emailId as string), { connection: workerRedis, concurrency: config.workerConcurrency });
  worker.on('completed', (job) => console.log(`Delivered job ${job.id}`));
  worker.on('failed', (job, error) => console.error(`Queue job ${job?.id ?? 'unknown'} failed:`, error.message));
  return worker;
}

export async function reconcileQueue() {
  await recoverStaleEmails(new Date(Date.now() - config.workerStaleMs));
  const emails = await listFutureScheduledEmails();
  for (const email of emails) {
    const jobId = `email:${email.id}:${email.attemptCount}`;
    const existing = await emailQueue.getJob(jobId);
    if (!existing) await scheduleEmailJob(email, email.attemptCount);
  }
  console.log(`Queue reconciliation complete: ${emails.length} scheduled emails checked.`);
}

export async function queueStats() {
  const counts = await emailQueue.getJobCounts('waiting', 'delayed', 'active', 'completed', 'failed');
  return counts;
}
