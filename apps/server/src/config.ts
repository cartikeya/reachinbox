import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), override: true });

const int = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const list = (value: string | undefined) => (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);

export const config = {
  port: int(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  appOrigin: process.env.APP_ORIGIN ?? `http://localhost:${int(process.env.PORT, 3000)}`,
  corsOrigins: list(process.env.CORS_ORIGINS),
  sessionSecret: process.env.SESSION_SECRET ?? 'development-only-change-me',
  allowDemoAuth: process.env.ALLOW_DEMO_AUTH === 'true',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://reachinbox:reachinbox@localhost:5432/reachinbox',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  elasticsearchUrl: process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200',
  workerConcurrency: int(process.env.WORKER_CONCURRENCY, 8),
  minSendDelayMs: int(process.env.MIN_SEND_DELAY_MS, 2000),
  maxEmailsPerHour: int(process.env.MAX_EMAILS_PER_HOUR, 200),
  workerStaleMs: int(process.env.WORKER_STALE_MS, 900000),
  etherealUser: process.env.ETHEREAL_USER,
  etherealPass: process.env.ETHEREAL_PASS,
  etherealHost: process.env.ETHEREAL_HOST ?? 'smtp.ethereal.email',
  etherealPort: int(process.env.ETHEREAL_PORT, 587),
  defaultSender: process.env.DEFAULT_SENDER_EMAIL ?? 'reachinbox.demo@ethereal.email',
  senderEmails: list(process.env.SENDER_EMAILS),
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL ?? `${process.env.APP_ORIGIN ?? 'http://localhost:3000'}/api/auth/google/callback`,
  slackClientId: process.env.SLACK_CLIENT_ID,
  slackClientSecret: process.env.SLACK_CLIENT_SECRET,
  slackRedirectUri: process.env.SLACK_REDIRECT_URI ?? `${process.env.APP_ORIGIN ?? 'http://localhost:3000'}/api/slack/callback`,
  slackScopes: process.env.SLACK_SCOPES ?? 'chat:write',
};

export const isProduction = config.nodeEnv === 'production';
