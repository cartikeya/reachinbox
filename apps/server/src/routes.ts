import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { demoLogin, googleCallback, googleStart, logout, requireUser, type AuthenticatedRequest, setSession } from './auth.js';
import { getOverview, getSlackConnection, insertEmails, listEmails, listSenders, ensureSender, disconnectSlack } from './db.js';
import { emailQueue, queueStats, scheduleEmailJob, redis } from './queue.js';
import { searchEmails, searchIsAvailable } from './search.js';
import { slackCallback, slackConnect } from './slack.js';
import type { ScheduleBatchInput } from './types.js';

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/health', async (_req, res) => {
  try { await redis.ping(); return res.json({ ok: true, queue: 'connected' }); }
  catch { return res.status(503).json({ ok: false, queue: 'unavailable' }); }
});

router.get('/auth/google', googleStart);
router.get('/auth/google/callback', googleCallback);
router.post('/auth/demo', demoLogin);
router.post('/auth/logout', logout);
router.get('/auth/me', requireUser, (req: AuthenticatedRequest, res) => res.json({ user: req.user }));

router.use(requireUser);

router.get('/senders', async (_req, res, next) => {
  try { return res.json({ senders: await listSenders() }); } catch (error) { return next(error); }
});

router.get('/overview', async (req: AuthenticatedRequest, res, next) => {
  try { return res.json({ overview: await getOverview(req.user!.id) }); } catch (error) { return next(error); }
});

router.get('/emails/:status', async (req: AuthenticatedRequest, res, next) => {
  try {
    const status = Array.isArray(req.params.status) ? req.params.status[0] : req.params.status;
    if (!['scheduled', 'sent', 'failed'].includes(status)) return res.status(400).json({ error: 'Unsupported email status.' });
    return res.json({ emails: await listEmails(req.user!.id, status as 'scheduled' | 'sent' | 'failed', typeof req.query.q === 'string' ? req.query.q : undefined) });
  } catch (error) { return next(error); }
});

router.get('/search', async (req: AuthenticatedRequest, res, next) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) return res.json({ emails: [], source: searchIsAvailable() ? 'elasticsearch' : 'postgres' });
    const indexed = await searchEmails(req.user!.id, query);
    if (indexed) return res.json({ emails: indexed, source: 'elasticsearch' });
    const [scheduled, sent, failed] = await Promise.all([
      listEmails(req.user!.id, 'scheduled', query), listEmails(req.user!.id, 'sent', query), listEmails(req.user!.id, 'failed', query),
    ]);
    return res.json({ emails: [...scheduled, ...sent, ...failed], source: 'postgres' });
  } catch (error) { return next(error); }
});

router.get('/queue', async (_req, res, next) => {
  try { return res.json({ stats: await queueStats() }); } catch (error) { return next(error); }
});

router.post('/schedule', async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = req.body as Partial<ScheduleBatchInput>;
    const recipients = [...new Set((input.recipients ?? []).map((value) => String(value).trim().toLowerCase()).filter((value) => emailPattern.test(value)))];
    if (!recipients.length || recipients.length > 5000) return res.status(400).json({ error: 'Provide between 1 and 5000 valid recipient email addresses.' });
    if (!input.subject?.trim() || !input.body?.trim()) return res.status(400).json({ error: 'Subject and body are required.' });
    if (!input.senderEmail || !emailPattern.test(input.senderEmail)) return res.status(400).json({ error: 'A valid sender email is required.' });
    const startAt = new Date(input.startAt ?? '');
    if (Number.isNaN(startAt.getTime())) return res.status(400).json({ error: 'Start time must be a valid ISO date.' });
    const delayBetweenMs = Math.max(0, Math.min(3600000, Number(input.delayBetweenMs ?? 2000)));
    const hourlyLimit = Math.max(1, Math.min(100000, Number(input.hourlyLimit ?? 200)));
    await ensureSender(input.senderEmail);
    const batchId = uuid();
    const rows = recipients.map((recipientEmail, index) => ({ recipientEmail, senderEmail: input.senderEmail!, subject: input.subject!.trim(), body: input.body!.trim(), scheduledAt: new Date(startAt.getTime() + index * delayBetweenMs).toISOString(), delayBetweenMs, hourlyLimit }));
    const inserted = await insertEmails({ userId: req.user!.id, batchId, rows });
    await Promise.all(inserted.map((email) => scheduleEmailJob(email, email.attemptCount)));
    return res.status(201).json({ batchId, count: inserted.length, skippedDuplicates: recipients.length - inserted.length, emails: inserted });
  } catch (error) { return next(error); }
});

router.get('/slack/status', async (req: AuthenticatedRequest, res, next) => {
  try {
    const connection = await getSlackConnection(req.user!.id);
    return res.json({ connected: Boolean(connection), teamName: connection?.team_name ?? null, channelId: connection?.channel_id ?? null });
  } catch (error) { return next(error); }
});
router.get('/slack/connect', slackConnect);
router.get('/slack/callback', slackCallback);
router.post('/slack/disconnect', async (req: AuthenticatedRequest, res, next) => {
  try { await disconnectSlack(req.user!.id); return res.json({ ok: true }); } catch (error) { return next(error); }
});

router.use((error: unknown, _req: AuthenticatedRequest, res: any, _next: any) => {
  console.error(error);
  return res.status(500).json({ error: error instanceof Error ? error.message : 'Unexpected server error.' });
});

export default router;
