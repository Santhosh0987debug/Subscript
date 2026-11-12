# Local development

## Prerequisites

- Node.js 22.12 or newer and npm 10 or newer
- PostgreSQL 15+ and Redis 7+ only for the Prisma-backed runtime and workers
- Chromium for Playwright (installed separately by `npx playwright install chromium`)
- Docker Desktop only if you want the provided Compose services

Linting, typechecking, unit tests, and builds do not need a database or Redis.

## Install

```bash
npm install
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

Windows PowerShell:

```powershell
npm install
Copy-Item apps/server/.env.example apps/server/.env
Copy-Item apps/web/.env.example apps/web/.env
```

`npm install` runs `prisma generate` through the root `postinstall` script and
writes the client to `apps/server/src/generated/prisma` (gitignored).

## Run without PostgreSQL

Leave `DATABASE_URL` commented out in `apps/server/.env`, then:

```bash
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000
- Health: http://localhost:4000/api/health

All stores use memory and reset on API restart. This is a development-only
fallback; production always requires PostgreSQL.

## Run with PostgreSQL and Redis

If Docker is available:

```bash
docker compose up -d
```

The Compose defaults are:

| Service | Value |
| --- | --- |
| PostgreSQL | `localhost:5432`, user `subscript`, password `subscript_dev`, database `subscript` |
| Redis | `localhost:6379` |

Uncomment and adjust `DATABASE_URL` in `apps/server/.env`, then apply the
committed migrations:

```bash
npm run db:deploy
```

For day-to-day schema changes, use `npm run db:migrate` to create and apply a
development migration. Never point development migrations at production data.

Start the API and web:

```bash
npm run dev
```

In a second terminal, start the automation worker (requires both `DATABASE_URL`
and `REDIS_URL`):

```bash
npm run dev:worker -w @subscript/server
```

The API reports automation as disabled when Redis is absent; the worker refuses
to start without both dependencies.

## Razorpay Test Mode

Online checkout is disabled until `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and
`RAZORPAY_WEBHOOK_SECRET` are all set. Use Test Mode keys. For local webhook
delivery, expose the API through a tunnel (for example ngrok) and create a
webhook at:

```text
https://<public-api-host>/api/webhooks/razorpay
```

Subscribe to `payment.captured`, `payment.failed`, `order.paid`,
`refund.created`, `refund.processed`, and `refund.failed`. The API verifies the
signature over the raw body, so do not let a proxy rewrite webhook payloads.

See [razorpay.md](./razorpay.md) for the full flow.

## Browser end-to-end tests

Install Chromium once:

```bash
npx playwright install chromium
```

Then:

```bash
npm run test:e2e
# or watch it run:
npm run test:e2e:headed
```

Playwright starts its own compiled API (memory stores) on port 4000 and a built
web preview on port 4173. In local runs it reuses already-running servers on
those ports. In CI it always starts fresh servers. Tests use one worker because
they share those ports and the API's auth rate limit.

To target different ports:

```powershell
$env:E2E_API_URL='http://localhost:4100'
$env:E2E_WEB_URL='http://localhost:4273'
$env:CORS_ORIGINS='http://localhost:4273'
npm run test:e2e
```

## Common tasks

| Task | Command |
| --- | --- |
| Build shared, web, and server | `npm run build` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Unit and API tests | `npm test` |
| Browser flows | `npm run test:e2e` |
| Generate Prisma client | `npm run db:generate` |
| Validate Prisma schema | `npm run db:validate` |
| Apply committed migrations | `npm run db:deploy` |
| Create a development migration | `npm run db:migrate` |
| Prisma Studio | `npm run db:studio` |

## Troubleshooting

### Playwright times out waiting for a web server

- Check that ports 4000 and 4173 are free, or stop stale node processes.
- Run with debug logging: `$env:DEBUG='pw:webserver'; npm run test:e2e`.
- The first run builds the shared package, server, and web app, so allow a
  couple of minutes.
- If a previous run was interrupted, delete `test-results/` and retry; stale
  servers can hold a port without responding.

### `__Host-` cookie is rejected locally

`__Host-` cookies require HTTPS and no `Domain` attribute. Development defaults
to `subscript_session`; leave `SESSION_COOKIE_NAME` unset unless you are testing
production cookie behavior over HTTPS.

### Prisma cannot connect

- Confirm `DATABASE_URL` uses `postgresql://` or `postgres://`.
- Confirm PostgreSQL is running and the database exists.
- Run `npm run db:deploy` to apply migrations.
- The API creates connections lazily; a bad URL fails on the first query, not at
  process start.
- In Docker or a managed database, add `?sslmode=require` when the provider
  requires TLS.

### 429 responses during manual testing

The global API limiter defaults to 600 requests per minute; auth endpoints
default to 20 failed attempts per 15 minutes. In tests, `createTestApp` disables
rate limits unless a test opts in. Do not raise production limits just to make a
local script pass; fix the script or wait for the window to reset.

### Automation is disabled in the API

Set `REDIS_URL` and restart. The worker also needs `DATABASE_URL`. Redis is
optional for API liveness/readiness, but required to dispatch and consume jobs.

## Related documents

- [configuration.md](./configuration.md)
- [database.md](./database.md)
- [workers.md](./workers.md)
- [testing.md](./testing.md)
- [deployment.md](./deployment.md)
