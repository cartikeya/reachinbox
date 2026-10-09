import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { parse, serialize } from 'cookie';
import type { NextFunction, Request, Response } from 'express';
import { config, isProduction } from './config.js';
import { getUserById, upsertUser } from './db.js';
import type { User } from './types.js';

export const SESSION_COOKIE = 'webdev_app_session';
const OAUTH_STATE_COOKIE = 'google_oauth_state';
const secureCookie = isProduction || process.env.COOKIE_SECURE === 'true';

export interface AuthenticatedRequest extends Request {
  user?: User;
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: secureCookie,
  sameSite: secureCookie ? 'none' as const : 'lax' as const,
  path: '/',
  maxAge,
});

export function getSessionUserId(req: Request) {
  const token = parse(req.headers.cookie ?? '')[SESSION_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.sessionSecret) as { userId?: string };
    return payload.userId ?? null;
  } catch {
    return null;
  }
}

export function setSession(res: Response, user: User) {
  const token = jwt.sign({ userId: user.id }, config.sessionSecret, { expiresIn: '14d' });
  res.setHeader('Set-Cookie', serialize(SESSION_COOKIE, token, cookieOptions(60 * 60 * 24 * 14)));
}

export function clearSession(res: Response) {
  res.setHeader('Set-Cookie', serialize(SESSION_COOKIE, '', cookieOptions(0)));
}

export async function requireUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const userId = getSessionUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });
  const user = await getUserById(userId);
  if (!user) return res.status(401).json({ error: 'Session expired.' });
  req.user = user;
  return next();
}

export function googleStart(req: Request, res: Response) {
  if (!config.googleClientId || !config.googleClientSecret) {
    return res.status(503).json({ error: 'Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' });
  }
  const nonce = crypto.randomBytes(24).toString('hex');
  res.setHeader('Set-Cookie', serialize(OAUTH_STATE_COOKIE, nonce, cookieOptions(600)));
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleCallbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state: nonce,
    access_type: 'offline',
    prompt: 'select_account',
  });
  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

export async function googleCallback(req: Request, res: Response) {
  const state = String(req.query.state ?? '');
  const storedState = parse(req.headers.cookie ?? '')[OAUTH_STATE_COOKIE];
  if (!state || !storedState || state !== storedState) return res.status(400).send('OAuth state validation failed.');
  if (!config.googleClientId || !config.googleClientSecret) return res.status(503).send('Google OAuth is not configured.');
  const code = String(req.query.code ?? '');
  if (!code) return res.status(400).send('Google OAuth did not return an authorization code.');

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: config.googleClientId, client_secret: config.googleClientSecret, redirect_uri: config.googleCallbackUrl, grant_type: 'authorization_code' }),
  });
  if (!tokenResponse.ok) return res.status(502).send('Google token exchange failed.');
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) return res.status(502).send('Google did not return an access token.');
  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (!profileResponse.ok) return res.status(502).send('Google profile lookup failed.');
  const profile = await profileResponse.json() as { sub: string; name?: string; email: string; picture?: string };
  const user = await upsertUser({ googleId: profile.sub, name: profile.name ?? profile.email.split('@')[0], email: profile.email, avatarUrl: profile.picture });
  setSession(res, user);
  return res.redirect('/');
}

export async function demoLogin(req: Request, res: Response) {
  if (!config.allowDemoAuth) return res.status(404).json({ error: 'Demo authentication is disabled.' });
  const user = await upsertUser({ googleId: 'demo-user', name: 'Demo Operator', email: 'demo@reachinbox.local', avatarUrl: 'https://api.dicebear.com/9.x/shapes/svg?seed=reachinbox' });
  setSession(res, user);
  return res.json({ user });
}

export function logout(_req: Request, res: Response) {
  clearSession(res);
  return res.json({ ok: true });
}
