# Architecture

Subscript is an npm-workspaces monorepo with three deployable pieces and one
shared contract package:

```text
Browser
  │  HTTPS, HttpOnly session cookie
  ▼
apps/web  ──────────────►  apps/server (API process)
(React/Vite)                │        │
                            │        └── Redis + BullMQ
                            │                 ▲
                            ▼                 │
                       PostgreSQL ◄──── apps/server worker process
                       (source of truth)     (billing + notifications)
```

- `apps/web` — React 19, Vite, React Router, Tailwind CSS. A static SPA; it
  holds no secrets and calls the API with `credentials: "include"`.
- `apps/server` — Express 5 API. Also contains `worker.ts`, which runs the
  BullMQ consumers in a separate process using the same image and code.
- `packages/shared` — API paths, request/response types, enums, and error
  contracts imported by both sides. Build it before either app.
- `e2e` — Playwright browser flows against a built web app and API.

## Processes

### API process (`src/server.ts`)

Startup sequence:

1. `dotenv/config` loads `apps/server/.env` when the process runs from that
   workspace.
2. `parseEnv` validates every environment variable. Production requires
   `DATABASE_URL` and an HTTPS `CORS_ORIGINS` list and rejects insecure cookies.
3. Prisma is created through `@prisma/adapter-pg` with a bounded pool, UTC
   session timezone, and `statement_timeout`.
4. If `DATABASE_URL` is absent in development/test, in-memory stores replace
   every Prisma-backed store. Production never falls back to memory.
5. If `REDIS_URL` is present, a BullMQ queue client is created for dispatch and
   health. The API remains available without Redis; automation reports disabled.
6. Express middleware and routers are attached, then the HTTP server starts with
   explicit request, headers, keep-alive, and shutdown timeouts.
7. `SIGINT`/`SIGTERM` stop accepting connections, close the queue and Prisma,
   and force-exit after `SHUTDOWN_TIMEOUT_MS`.

The API can be scaled horizontally. It does not run scheduled work itself; a
manual dispatch endpoint and the worker process enqueue/consume durable jobs.

### Worker process (`src/worker.ts`)

The worker requires both `DATABASE_URL` and `REDIS_URL`. It:

- Creates Prisma stores and BullMQ consumers for the `billing` and
  `notifications` queues with configurable concurrency.
- Registers a repeatable sweep job and runs one sweep immediately on startup.
- Writes a Redis heartbeat every 20 seconds with a 90-second TTL.
- Recovers stale `RUNNING` jobs and `SENDING` notifications left by a crashed
  worker, and stale `QUEUED` rows whose BullMQ delivery was lost.
- Shuts down gracefully by closing consumers and the queue, then Prisma.

Workers can be scaled independently from the API. Duplicate deliveries are safe
because jobs and notifications are claimed atomically in PostgreSQL.

### Web build

Vite reads `VITE_API_URL` at build time and bakes it into the bundle. The web
app is served by nginx (Docker), Vercel, or Render Static Sites. Client-side
routes require an SPA fallback to `index.html`; all three provided deployment
configs include one.

## Request lifecycle

1. `requestId` accepts a well-formed caller `X-Request-Id` and a bounded
   `X-Correlation-Id`, or generates new UUIDs, and exposes both in response
   headers.
2. The request logger records method, route template, status, duration, and
   optional user/organization IDs. Query strings and bodies are never logged.
3. Helmet sets security headers. CORS allows only configured origins and
   exposes request-ID and retry headers.
4. The origin guard rejects unsafe methods with `Origin: null` or
   `Sec-Fetch-Site: cross-site`, providing CSRF defense beyond CORS.
5. `Cache-Control: no-store` is applied to `/api`.
6. The Razorpay webhook router is mounted before JSON parsing so signatures are
   checked against the exact raw body. All other requests pass through the JSON
   parser and cookie parser.
7. Liveness, readiness, and metrics routes are registered before the general API
   limiter so they stay reachable while the API sheds load.
8. The global API limiter runs, then feature routers apply authentication,
   tenant resolution, and role checks.
9. Errors become one JSON envelope. Internal messages and stacks are logged
   through the redacting logger but never returned in production.

## Multi-tenancy

- Every domain row carries `organizationId`.
- Authentication resolves the session, user, and active organization from the
  database on every protected request.
- `requireOrganization` confirms the membership still exists and supplies the
  role; a revoked member loses access immediately.
- Queries always scope by the session's organization. Cross-tenant IDs resolve as
  `404`; switching to an organization the user does not belong to returns `403`.
- Writes use `requireRole("OWNER", "ADMIN")`; members have read-only access to
  billing records and the operations console.
- Invoice numbers, provider IDs, webhook event IDs, and billing periods have
  database uniqueness constraints so concurrent requests cannot duplicate money
  movements.

## Billing and payments

- Plans snapshot their price and interval into a subscription at creation. Plan
  edits never rewrite historical pricing.
- Subscription transitions are centralized in one state machine with row locks.
- Invoice generation is idempotent per `(subscriptionId, periodStart,
  periodEnd)`, allocates per-organization numbers in the same transaction, and
  recomputes balances from payments.
- Manual payments and gateway payments share one ledger. Gateway checkout
  reserves a pending payment before calling Razorpay; a verified signature and
  provider fetch are required before a balance changes.
- Signed webhooks reconcile captures, failures, order payments, and refunds.
  Provider event IDs are deduplicated with a unique constraint.

## Automation

PostgreSQL is the durable source of truth; Redis/BullMQ is transport.

- Scheduling writes an `AutomationJob` row with a unique idempotency key before
  enqueueing it.
- BullMQ job IDs include the database job ID, dispatch generation, and timestamp,
  so a crash between insert and enqueue is recoverable.
- Workers claim rows with conditional updates; only one worker can process a
  job.
- Retries use bounded exponential backoff. Exhaustion moves a job or
  notification to `DEAD_LETTER`.
- Notifications are deduplicated by `dedupeKey` before delivery.

## Observability

- JSON logs with levels, timestamps, request/correlation IDs, and redaction of
  emails, bearer tokens, Razorpay keys, and long tokens.
- `/api/health` is liveness only; `/api/ready` checks PostgreSQL (required) and
  Redis (optional/degraded); `/api/metrics` is Prometheus text protected by an
  optional bearer token.
- Metrics include request counts by method/route/status, latency histograms,
  error counts, dependency gauges, uptime, and RSS.

See [observability.md](./observability.md) for the operational detail.

## Trust boundaries

| Boundary | Control |
| --- | --- |
| Browser → API | HTTPS, CORS allowlist, origin guard, HttpOnly session cookie, rate limits |
| API → PostgreSQL | Bounded pool, statement timeout, parameterized Prisma queries and `Prisma.sql` |
| API → Razorpay | Server-derived amounts, timing-safe signatures, provider re-fetch |
| Razorpay → API | Raw-body HMAC verification, event-ID deduplication, replay-safe processing |
| API/worker logs | Structured fields, no bodies/query strings, redaction, no stacks in production |
| Deployments | Secrets from the platform environment, never committed |

## Related documents

- [configuration.md](./configuration.md)
- [database.md](./database.md)
- [workers.md](./workers.md)
- [razorpay.md](./razorpay.md)
- [deployment.md](./deployment.md)
- [security.md](./security.md)
- [testing.md](./testing.md)
