# ReachInbox Email Scheduler

A production-shaped full-stack implementation of the ReachInbox hiring assignment: a React operations dashboard backed by Express, managed MySQL-compatible persistence, Redis/BullMQ delayed jobs, Ethereal SMTP, Elasticsearch search, Google OAuth, and Slack rate-limit alerts.

## Quick start

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open `http://localhost:3000`. The local demo-access button is only shown when `ALLOW_DEMO_AUTH=true`; real Google OAuth is available when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` are configured. Ethereal credentials are optional: when omitted, Nodemailer creates a disposable Ethereal test account and displays preview URLs in the Sent table.

## Architecture

Each recipient is stored as its own MySQL-compatible `emails` row with a stable `idempotency_key`. Scheduling uses BullMQ delayed jobs only; there is no cron job or cron library in the project. The BullMQ `jobId` is derived from the email ID and attempt number, so a restart reconciliation pass can restore a missing job without creating a duplicate. A worker claims a scheduled row with a conditional SQL update, reserves a per-sender send slot in Redis using an atomic Lua script, sends through Ethereal, and records `sent` or `failed` state.

Worker concurrency, the minimum delay between sends, and the per-sender hourly limit are configurable through `.env`. When Redis cannot reserve a slot, the job is returned to the delayed queue for the next available timestamp instead of being dropped. A Redis notification guard allows one Slack message per sender/hour. Slack OAuth stores the bot token in MySQL and `chat.postMessage` is called when a sender hits the hourly limit; if Slack is not connected, the notification is skipped without affecting delivery.

Elasticsearch indexes email state changes and powers `/api/search`. The application falls back to MySQL-compatible `LIKE` search if Elasticsearch is unavailable, which keeps the local demo usable while still implementing the required indexing path.

## Frontend

The dashboard includes scheduled and sent email tables, status metrics, a compose modal with CSV/TXT email detection, per-sender selection, start time, send delay, and hourly limit controls, loading and empty states, search, Slack connection status, and honest error feedback. The UI uses a dark editorial operations-console visual system rather than a generic centered card layout.

## Environment

See `.env.example` for all variables. MySQL, Redis, and Elasticsearch are supplied by `docker-compose.yml`. Google and Slack OAuth callback URLs must be registered with their providers. `SENDER_EMAILS` seeds the available sender identities; the queue rate limiter is keyed by sender, so multiple senders can run in parallel without sharing a quota.

## Assignment mapping

| Requirement | Implementation |
| --- | --- |
| Express + TypeScript | `apps/server/src/index.ts` and `routes.ts` |
| Persistent delayed scheduler | BullMQ + Redis in `queue.ts`; no cron |
| Relational persistence | MySQL-compatible schema in `migrations/001_init.sql` |
| SMTP | Nodemailer + Ethereal in `mailer.ts` |
| Search | Elasticsearch adapter with SQL fallback in `search.ts` and `/api/search` |
| Restart safety/idempotency | Startup reconciliation, stable job IDs, unique `idempotency_key` |
| Concurrency/delay/hourly limits | Configurable BullMQ concurrency and Redis Lua reservations |
| Slack notification | Real OAuth flow and live `chat.postMessage` in `slack.ts` |
| Google login | Real Google OAuth flow and signed application session in `auth.ts` |
| Dashboard | React + TypeScript + responsive custom CSS in `apps/web` |

## Assumptions and trade-offs

The assignment requires an exactly-once outcome from SMTP, but SMTP itself does not provide a distributed transaction with PostgreSQL. This implementation minimizes duplicates with conditional state claims, stable message IDs, unique idempotency keys, and recovery of stale in-flight rows. A process crash in the narrow interval after an SMTP server accepts a message and before MySQL records `sent` can still cause a retry; the stable `Message-ID` makes the attempt traceable, but a true exactly-once guarantee would require provider-side idempotency. This limitation is documented rather than hidden.

Slack channel selection uses the channel returned by Slack OAuth when available or `SLACK_CHANNEL_ID` as an override. Production deployments should use secret storage rather than committing `.env`. The provided demo-auth route is intentionally explicit and is not a replacement for Google OAuth.

## Demo

See [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md) and [`sample-leads.csv`](./sample-leads.csv).
