# Workers and Redis

Background automation runs in a separate process from the API so a slow renewal
sweep or notification retry cannot add API latency. PostgreSQL is the durable
source of truth; Redis/BullMQ is transport.

## Processes and queues

| Process | Command | Requirements |
| --- | --- | --- |
| API | `npm run start -w @subscript/server` (or `dist/server.js`) | `DATABASE_URL` in production; `REDIS_URL` optional for dispatch and health |
| Worker | `npm run start:worker -w @subscript/server` (or `dist/worker.js`) | `DATABASE_URL` and `REDIS_URL` required |

Queues:

- `billing` — renewal reminders, trial ending, trial activation, recurring
  invoices, cancel-at-period-end, status sync, payment recovery, expiration, and
  the repeatable system sweep.
- `notifications` — email delivery attempts.

The queue namespace is controlled by `AUTOMATION_QUEUE_PREFIX` (default
`subscript`). Use a distinct prefix per environment sharing a Redis instance.

## Job lifecycle

1. A sweep finds eligible work and writes an `AutomationJob` row with a unique
   idempotency key. The row is durable before any Redis entry exists.
2. The dispatcher enqueues a BullMQ job whose ID includes the database job ID,
   dispatch generation, and timestamp.
3. A worker atomically claims the row with a conditional update. A duplicate
   delivery finds it already claimed or completed and becomes a no-op.
4. The handler performs the billing/notification change through the existing
   transactional stores.
5. Success records a sanitized result summary; failure records a sanitized error
   and schedules a bounded exponential retry.
6. Exhaustion moves the row to `DEAD_LETTER`. Owners and admins can retry it
   from the Operations page.

Notifications follow the same insert-first pattern with a unique `dedupeKey`, so
duplicate sweeps or retries cannot send the same message twice.

## Sweeps, heartbeats, and recovery

- The worker installs a repeatable sweep schedule and runs one sweep immediately
  on startup. If BullMQ is not ready, it retries installation every 60 seconds.
- A heartbeat is written every 20 seconds with a 90-second TTL. The Operations
  page uses it to show whether a worker is alive.
- Each sweep recovers:
  - `RUNNING` jobs older than `AUTOMATION_WORKER_STALE_SECONDS`
  - `QUEUED` jobs whose dispatch is older than the stale threshold
  - `SENDING` notifications older than the threshold
  - `QUEUED` notifications whose dispatch was lost
- Recovery returns rows to a retryable state; the next dispatch re-enqueues
  them. Because handlers are idempotent or guarded by status transitions,
  reprocessing cannot duplicate an invoice or payment.

## Redis loss and restart

Redis is not the source of truth:

- If Redis is unavailable at API startup, the API still starts. Automation shows
  as disabled and checkout/billing endpoints that do not need automation keep
  working.
- If Redis is lost at runtime, pending durable rows remain in PostgreSQL.
  Reconnect the worker and run a sweep (the worker does this on startup) to
  re-dispatch.
- Job IDs and idempotency keys prevent duplicate side effects after a reconnect.
- Redis persistence (AOF/RDB) is still recommended to reduce re-dispatch volume,
  but it is not required for correctness.

Readiness treats Redis as optional: `/api/ready` returns `200` with
`status: "degraded"` when Redis is down, and `503` only when PostgreSQL is down.

## Scaling

- Run at least one worker whenever automation is expected. Running two is safe
  and increases throughput.
- Scale billing and notification concurrency independently with
  `AUTOMATION_BILLING_CONCURRENCY` and
  `AUTOMATION_NOTIFICATION_CONCURRENCY`.
- Keep the sweep interval at least 15 seconds. A shorter interval does not make
  actions run sooner than their `runAt` time and increases load.
- Use the same `AUTOMATION_QUEUE_PREFIX` for the API and all workers in one
  environment.
- Size the PostgreSQL pool for API replicas + worker replicas (see
  [database.md](./database.md)).

## Operational signals

- `subscript_http_requests_total` and
  `subscript_http_request_duration_ms` cover API traffic.
- `/api/ready` exposes dependency health and latency.
- Automation logs include job ID, type, attempt, and status; they exclude raw
  payloads, notification bodies, and secrets.
- The Operations page (`/automation`) shows counts, upcoming renewals, job and
  notification history, and retry/dispatch controls.

## Common incidents

### Worker starts but no jobs run

1. Check `REDIS_URL` and `DATABASE_URL` in the worker environment.
2. Check the Operations page for queue counts and heartbeat age.
3. Confirm `AUTOMATION_QUEUE_PREFIX` matches the API.
4. Look for queue connection errors in the worker logs.
5. Trigger a manual dispatch as an owner/admin and watch the job history.

### Jobs stuck in `RUNNING`

A worker likely crashed mid-job. Wait for the stale threshold
(`AUTOMATION_WORKER_STALE_SECONDS`, default 300 seconds) and the next sweep, or
restart the worker. Do not manually flip rows to `PENDING` unless you understand
the handler's idempotency guarantees and have checked that no worker is still
processing them.

### Notification dead letters

Check the sanitized error and SMTP configuration. Fix credentials or the
recipient, then retry from the Operations page. Message bodies and credentials
are never returned by the API.

### Redis is down

Keep the API running; it will report degraded readiness. Restore Redis, restart
the worker, and verify that the sweep recovers pending rows. No durable job is
lost by a Redis restart.

## Email delivery

Without `SMTP_HOST`, the development adapter logs a short non-sensitive preview
and sends nothing. Set `SMTP_HOST`, optional `SMTP_USER`/`SMTP_PASSWORD` (both or
neither), `SMTP_PORT`, `SMTP_SECURE`, and `EMAIL_FROM` to enable SMTP. Delivery
attempts, next-attempt time, provider message ID, and sanitized errors are
stored; bodies and credentials are not exposed.
