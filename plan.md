# ReachInbox Email Scheduler — Implementation Plan

## Scope

Build a production-shaped monorepo for the hiring assignment: a React + TypeScript dashboard backed by an Express + TypeScript API, PostgreSQL persistence, Redis/BullMQ delayed jobs, Ethereal SMTP delivery, Elasticsearch indexing, Google OAuth, Slack OAuth notifications, and restart-safe scheduling.

## Architecture

- **API/server (`apps/server`)**: Express routes, session/auth handling, PostgreSQL repositories, schedule orchestration, Elasticsearch indexing/search, BullMQ queue/worker, Redis-backed rate reservation, Ethereal SMTP transport, Google and Slack OAuth callbacks.
- **Dashboard (`apps/web`)**: Vite React app with a dark operations-console layout, client-side API helpers, reusable status/table/modal components, CSV parsing and upload preview.
- **Infrastructure**: Docker Compose for PostgreSQL, Redis, and Elasticsearch. The API serves the built dashboard in production and runs on port 3000 for Preview.
- **Persistence**: One `emails` row per recipient with a stable idempotency key and BullMQ `jobId` derived from the email ID. Startup reconciliation rehydrates missing delayed jobs, and stale `sending` rows are recovered to `scheduled`.
- **Rate limiting**: Redis Lua-backed per-sender hourly reservation plus per-sender minimum-send-time reservation. If a reservation is unavailable, the job is re-enqueued for the next available timestamp instead of being dropped. A per-window notification guard triggers Slack once per sender/window.
- **Authentication**: Real Google OAuth is wired when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are provided; the dashboard shows a clear configuration state otherwise. A deliberately explicit local demo-session button is available only when `ALLOW_DEMO_AUTH=true` for evaluation without provider credentials.

## Product design

- **Design movement**: Editorial operations console — restrained, high-contrast, and data-first rather than a generic SaaS template.
- **Core principles**: Calm density, visible system state, fast composition, and strong hierarchy.
- **Color philosophy**: Ink/navy surfaces make operational data easy to scan; electric violet is the ownable action color; mint and amber communicate delivery and throttling without relying on red-heavy alerts.
- **Layout paradigm**: A persistent left rail anchors navigation while a broad workspace uses a single primary table and side-panel composition flow, avoiding a centered marketing-card grid.
- **Signature elements**: Violet “signal” gradient, thin hairline grid texture, and status pills with small live-dot indicators.
- **Interaction philosophy**: Actions are direct and reversible; scheduling uses inline summaries, optimistic feedback is avoided in favor of honest loading states, and empty states teach the next action.
- **Animation**: 150–220ms ease-out transitions, subtle row/indicator shimmer only while loading, and no decorative motion competing with tables.
- **Typography system**: Inter for UI and dense data, Space Grotesk for headings and wordmark; type hierarchy favors compact uppercase labels and oversized numeric counters.
- **Brand essence**: “A dependable send-control room for thoughtful outbound.” Personality: precise, composed, quietly powerful.
- **Brand voice**: Headlines sound operational and confident; CTAs are specific. Example lines: “Put every send on a rail.” / “Queue the next conversation.”
- **Wordmark & logo**: `reach/INBOX` with a split-signal mark: two violet bars converging into a mint dot.
- **Signature brand color**: Signal Violet `#8B5CF6`.

## Project structure

```text
apps/server/src/
  config.ts                 environment parsing
  db.ts                     PostgreSQL pool and schema bootstrap
  types.ts                  shared server types
  auth.ts                   Google OAuth, demo auth, sessions
  slack.ts                  Slack OAuth + notification delivery
  search.ts                 Elasticsearch indexing/search adapter
  queue.ts                  BullMQ queue, worker, recovery and rate reservations
  mailer.ts                 Ethereal/Nodemailer transport
  repositories.ts           SQL persistence and idempotent state transitions
  routes.ts                 REST API and OAuth routes
  index.ts                  Express bootstrap and static serving
apps/web/src/
  api.ts                    typed API client
  App.tsx                   dashboard state and routes
  components.tsx            reusable UI pieces and compose modal
  main.tsx                  Vite entry
  styles.css                visual system
migrations/001_init.sql     relational schema
public/manus-routes.json    Preview route manifest
Dockerfile                  production API + static dashboard image
```

## Required behavior preserved

- No cron jobs; only BullMQ delayed jobs and startup reconciliation.
- Configurable worker concurrency, minimum delay, and hourly limits.
- Multiple senders; rate reservations are keyed by sender and hourly window in Redis.
- Emails remain scheduled/sent/failed in PostgreSQL and searchable through Elasticsearch when configured, with a PostgreSQL fallback for local setup.
- Slack is optional and failure-safe until connected; when connected, the backend sends a live `chat.postMessage` at the first limit hit per sender/hour.
- CSV/text leads are parsed client-side and submitted as a batch schedule request.
- Restart behavior, idempotency, assumptions, environment variables, and demo flow are documented in README.md.
