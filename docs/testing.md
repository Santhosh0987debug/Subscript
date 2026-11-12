# Testing

Subscript has four test layers plus static checks.

| Layer | Tool | Location | Needs infrastructure |
| --- | --- | --- | --- |
| Unit and API | Vitest + Supertest | `apps/server/tests` | No (memory stores), optional PostgreSQL/Redis |
| Web unit | Vitest | `apps/web/src/**/*.test.ts(x)` | No |
| Browser E2E | Playwright | `e2e` | Built web + API; memory stores |
| PostgreSQL/BullMQ integration | Vitest | `apps/server/tests/*-postgres.test.ts`, `automation-redis.test.ts` | PostgreSQL and Redis |

## Commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run db:validate
npm run test:e2e
```

`npm test` builds shared contracts, then runs the server and web suites. Server
tests that need infrastructure skip automatically unless the relevant
environment variables are set.

## Current coverage

- Server: authentication and session lifecycle, RBAC and tenant isolation,
  customers, plans, subscriptions, invoices, manual payments, gateway checkout
  and webhooks, refunds, analytics, automation scheduling, retries, stale
  recovery, notification deduplication, health/readiness/metrics, rate limits,
  origin guard, cookie hardening, log redaction, and environment validation.
- Web: form validation, billing helpers, money formatting, identity helpers,
  and analytics helpers.
- E2E: registration → logout → login, invalid credentials without account
  enumeration, cross-tenant organization switching denial, and a full revenue
  workflow (customer → plan → subscription → invoice → analytics).
- Integration: real PostgreSQL row locks, unique constraints, concurrent
  invoice/payment/gateway writes, analytics SQL, stale job recovery, and an
  optional BullMQ round trip.

Expected results without infrastructure:

```text
Server: 201 passed, 20 skipped
Web:    82 passed
E2E:    4 passed
```

With a disposable PostgreSQL database, the 18 PostgreSQL integration tests also
run. With Redis, the optional BullMQ test runs.

## PostgreSQL integration tests

Use a throwaway database, never production:

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres@localhost:55432/subscript_test'
npm run db:deploy
npx vitest run tests/analytics-postgres.test.ts tests/automation-postgres.test.ts tests/billing-postgres.test.ts tests/gateway-postgres.test.ts
```

Bash equivalent:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/subscript_test npm run db:deploy
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/subscript_test \
  npx vitest run tests/analytics-postgres.test.ts tests/automation-postgres.test.ts tests/billing-postgres.test.ts tests/gateway-postgres.test.ts
```

These tests truncate and recreate data in the target database. Never point
`TEST_DATABASE_URL` at a database you need to keep.

## Redis integration test

```powershell
$env:TEST_REDIS_URL='redis://localhost:6379'
npx vitest run tests/automation-redis.test.ts
```

Use a dedicated Redis database or instance; the test registers queues and
workers under the configured prefix.

## Browser E2E

Install Chromium once:

```bash
npx playwright install chromium
```

`playwright.config.ts`:

- Starts the compiled API with memory stores on port 4000 and a built web
  preview on port 4173.
- Uses one worker because both servers and the auth rate limit are shared.
- Reuses existing local servers when `CI` is not set.
- Retains traces and screenshots on failure.

Run headed for debugging:

```bash
npm run test:e2e:headed
```

Artifacts:

- `test-results/` — traces, screenshots, and error context
- `playwright-report/` — HTML report when configured

Both are gitignored.

### Writing E2E tests

- Use accessible roles and labels; avoid CSS selectors.
- Use `getByLabel(name, { exact: true })` for fields whose label is a prefix of
  another control (for example "Password" vs. "Show password").
- Generate unique emails with `uniqueEmail(prefix)`.
- Keep tests independent; do not depend on records created by another test.
- The API stores reset when the Playwright-managed server restarts, so do not
  reuse accounts across runs.
- Prefer one end-to-end revenue flow over many shallow page checks.

## CI

`.github/workflows/ci.yml` runs three jobs:

1. **verify** — lint, typecheck, unit/API tests, production build, Prisma
   validation, and `npm audit --audit-level=high`.
2. **integration** — PostgreSQL 17 and Redis 7 services, `npm run db:deploy`,
   then all server tests with `TEST_DATABASE_URL` and `TEST_REDIS_URL`.
3. **e2e** — Chromium install and `npm run test:e2e`, with failure artifacts
   uploaded.

All jobs run on pushes to `main` and pull requests. Dependencies are installed
with `npm ci` and the repository's `package-lock.json`.

## Interpreting failures

- **401 on `/api/auth/me` in Playwright logs** — expected when a test starts
  signed out; only a failure if the test expected a session.
- **429** — a rate limit was hit. Tests that exercise limits opt in with a tiny
  window; other suites disable limits through `createTestApp`.
- **Playwright webServer timeout** — free ports 4000/4173, remove stale
  `test-results/`, and rerun with `DEBUG=pw:webserver`.
- **Prisma integration tests skipped** — `TEST_DATABASE_URL` is unset. Apply
  migrations first.
- **Redis test skipped** — `TEST_REDIS_URL` is unset.
- **Docker checks** — Docker is optional locally; CI uses native services and
  builds the applications without Docker. Build the images before a real
  container deployment.

## What is intentionally not automated

- Live Razorpay charges and live webhook delivery.
- Real SMTP delivery.
- Managed-platform deploys (Vercel/Render).
- Load, soak, and penetration testing.

Gateway behavior is covered with a mocked provider and signed synthetic
webhooks. Live confirmation requires your own Test Mode credentials and a public
webhook URL.
