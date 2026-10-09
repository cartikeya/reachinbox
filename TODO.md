# Implementation checklist

- [ ] The TypeScript Express backend accepts email scheduling requests, stores one durable relational record per recipient, and exposes scheduled/sent/search APIs.
- [ ] BullMQ delayed jobs backed by Redis are the only scheduler; no cron jobs or cron libraries are used.
- [ ] Startup reconciliation preserves future send times after restart, rehydrates missing jobs, and uses stable idempotency keys so a job is not scheduled more than once.
- [ ] Ethereal SMTP delivery supports multiple sender identities, records sent/failed state, and exposes preview URLs when available.
- [ ] Elasticsearch indexing/search is implemented with a PostgreSQL fallback when Elasticsearch is not configured.
- [ ] Worker concurrency, minimum delay, and per-sender hourly limits are configurable; Redis-backed reservations safely coordinate parallel workers and reschedule instead of dropping jobs.
- [ ] A live Slack OAuth flow stores the connected tenant token and sends a real Slack notification when a sender hourly limit is first reached in a window; disconnected Slack is a no-op.
- [ ] Google OAuth login is implemented with callback/session handling, user name/email/avatar, and logout; explicit local demo auth is only available when enabled for evaluation.
- [ ] The React TypeScript dashboard provides Scheduled Emails and Sent Emails views, a Compose New Email flow, CSV/text parsing with detected-address count, scheduling controls, loading states, empty states, reusable UI pieces, and error feedback.
- [ ] Docker Compose provides PostgreSQL, Redis, and Elasticsearch; `.env.example`, migrations, server/client scripts, README, and a five-minute demo script are included.
- [ ] The application builds, typechecks, serves `manus-routes.json`, listens on port 3000, and is verified through health/API checks.
