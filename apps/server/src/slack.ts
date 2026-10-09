import { parse, serialize } from 'cookie';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { config, isProduction } from './config.js';
import { getSlackConnection, saveSlackConnection } from './db.js';
import type { AuthenticatedRequest } from './auth.js';

const STATE_COOKIE = 'slack_oauth_state';
const secureCookie = isProduction || process.env.COOKIE_SECURE === 'true';
const slackCookie = (maxAge: number) => serialize(STATE_COOKIE, '', { httpOnly: true, secure: secureCookie, sameSite: secureCookie ? 'none' : 'lax', path: '/', maxAge });

export function slackConnect(_req: Request, res: Response) {
  if (!config.slackClientId || !config.slackClientSecret) return res.status(503).json({ error: 'Slack OAuth is not configured. Add SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.' });
  const state = crypto.randomBytes(24).toString('hex');
  res.setHeader('Set-Cookie', serialize(STATE_COOKIE, state, { httpOnly: true, secure: secureCookie, sameSite: secureCookie ? 'none' : 'lax', path: '/', maxAge: 600 }));
  const params = new URLSearchParams({ client_id: config.slackClientId, scope: config.slackScopes, redirect_uri: config.slackRedirectUri, state });
  return res.redirect(`https://slack.com/oauth/v2/authorize?${params.toString()}`);
}

export async function slackCallback(req: AuthenticatedRequest, res: Response) {
  const state = String(req.query.state ?? '');
  const stored = parse(req.headers.cookie ?? '')[STATE_COOKIE];
  const userId = req.user?.id ?? '';
  if (!state || state !== stored) return res.status(400).send('Slack OAuth state validation failed.');
  if (!userId) return res.status(400).send('Slack connection is missing the application user.');
  if (!config.slackClientId || !config.slackClientSecret) return res.status(503).send('Slack OAuth is not configured.');
  const code = String(req.query.code ?? '');
  const response = await fetch('https://slack.com/api/oauth.v2.access', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.slackClientId, client_secret: config.slackClientSecret, code, redirect_uri: config.slackRedirectUri }) });
  const payload = await response.json() as { ok?: boolean; access_token?: string; team?: { id?: string; name?: string }; incoming_webhook?: { channel_id?: string }; error?: string };
  if (!payload.ok || !payload.access_token) return res.status(502).send(`Slack OAuth failed: ${payload.error ?? 'unknown error'}`);
  await saveSlackConnection({ userId, teamId: payload.team?.id, teamName: payload.team?.name, accessToken: payload.access_token, channelId: payload.incoming_webhook?.channel_id ?? process.env.SLACK_CHANNEL_ID });
  res.setHeader('Set-Cookie', slackCookie(0));
  return res.redirect('/?slack=connected');
}

export async function notifyRateLimitHit(input: { userId: string; senderEmail: string; window: string; redis: { set: (...args: any[]) => Promise<unknown> } }) {
  const guardKey = `slack-notified:${input.userId}:${input.senderEmail}:${input.window}`;
  const connection = await getSlackConnection(input.userId);
  if (!connection) return false;
  const channel = connection.channel_id ?? process.env.SLACK_CHANNEL_ID;
  if (!channel) return false;
  const first = await input.redis.set(guardKey, '1', 'EX', 3700, 'NX');
  if (first !== 'OK') return false;
  const response = await fetch('https://slack.com/api/chat.postMessage', { method: 'POST', headers: { Authorization: `Bearer ${connection.access_token}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ channel, text: `ReachInbox throttled ${input.senderEmail}: the hourly limit was reached for window ${input.window}. Queued emails will resume in the next available window.` }) });
  const result = await response.json() as { ok?: boolean };
  return result.ok === true;
}
