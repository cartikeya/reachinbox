# Five-minute demo script

1. Start `docker compose up -d`, copy `.env.example` to `.env`, run `pnpm install`, then `pnpm dev`.
2. Open the dashboard. For a local evaluation without provider credentials, click the explicit demo access button; with Google credentials configured, use the real Google OAuth button.
3. Open Compose, upload `sample-leads.csv`, verify the detected count, choose a sender, subject, body, start time, delay, and hourly limit, then schedule.
4. Show the Scheduled table and metrics. Explain that each recipient is a PostgreSQL row and each row has a BullMQ delayed job with a stable idempotency job ID.
5. Set `MAX_EMAILS_PER_HOUR=2` and a short delay in `.env`, restart the server, schedule three leads, and show queue pacing. If Slack is configured, connect it in the dashboard and show the live rate-limit alert.
6. Stop and start the server while a future email is scheduled. Refresh the dashboard; startup reconciliation rehydrates the missing delayed job from PostgreSQL without duplicating the row.
7. Open a sent row's Ethereal preview link and mention that Elasticsearch indexes every state transition when the service is available, with PostgreSQL search fallback for local setups.
