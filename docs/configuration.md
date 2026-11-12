# Configuration

The API validates its environment at startup and fails fast with a readable list
of issues. Never commit real `.env` files; copy the examples and use the hosting
platform's secret store in staging and production.

- Server example: `apps/server/.env.example`
- Web example: `apps/web/.env.example`

When running through npm workspaces, the API and worker load
`apps/server/.env`. The web app reads `apps/web/.env` (or the process
environment) at build time.

## Server and worker

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | `development`, `test`, or `production` |
| `PORT` | No | `4000` | 1–65535. Render supplies its own port automatically |
| `DATABASE_URL` | Production | — | `postgresql://` or `postgres://`; required in production. Absence enables memory stores in development/test only |
| `CORS_ORIGINS` | Production | Local Vite origins | Comma-separated exact origins. Wildcards and paths are rejected; production requires HTTPS |
| `SESSION_TTL_DAYS` | No | `7` | 1–30 days |
| `BCRYPT_COST` | No | `12` | 10–14; lower only in tests |
| `COOKIE_SECURE` | No | `true` in production | Must be `true` in production; a `__Host-` cookie name also requires it |
| `SESSION_COOKIE_NAME` | No | `__Host-subscript_session` in production, `subscript_session` otherwise | 1–64 characters of `A-Z`, `a-z`, `0-9`, `_`, `-` |
| `TRUST_PROXY` | No | `false` | Set `true` only behind a trusted reverse proxy so `req.ip` and rate limits see the client address |
| `API_RATE_LIMIT_WINDOW_SECONDS` | No | `60` | 10–3600 seconds for the global `/api` limiter |
| `API_RATE_LIMIT_MAX` | No | `600` | 30–100000 requests per window per client |
| `DB_POOL_MAX` | No | `10` | PostgreSQL pool size per process |
| `DB_IDLE_TIMEOUT_MS` | No | `30000` | Idle connection timeout |
| `DB_CONNECTION_TIMEOUT_MS` | No | `5000` | Time to wait for a pooled connection |
| `DB_STATEMENT_TIMEOUT_MS` | No | `15000` | Server-side `statement_timeout` for every query |
| `HTTP_REQUEST_TIMEOUT_MS` | No | `60000` | Whole-request timeout |
| `HTTP_HEADERS_TIMEOUT_MS` | No | `65000` | Must exceed keep-alive; validated |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS` | No | `5000` | Keep-alive idle timeout |
| `SHUTDOWN_TIMEOUT_MS` | No | `15000` | Graceful shutdown budget before a forced exit |
| `METRICS_TOKEN` | No | — | 16–200 characters. When unset, `/api/metrics` returns `404`. When set, requires `Authorization: Bearer <token>` |
| `LOG_REQUESTS` | No | `true` | Per-request structured logs. Health, readiness, and metrics are always excluded from access logs |
| `RAZORPAY_KEY_ID` | Gateway | — | Must start with `rzp_test_` or `rzp_live_`; live keys are rejected outside production |
| `RAZORPAY_KEY_SECRET` | Gateway | — | 8–200 characters; never logged or returned |
| `RAZORPAY_WEBHOOK_SECRET` | Gateway | — | 8–200 characters; verifies `X-Razorpay-Signature` |
| `REDIS_URL` | Worker | — | `redis://` or `rediss://`. The API starts without it; the worker requires it |
| `AUTOMATION_QUEUE_PREFIX` | No | `subscript` | 1–40 characters of `A-Z`, `a-z`, `0-9`, `_`, `-` |
| `AUTOMATION_BILLING_CONCURRENCY` | No | `5` | 1–50 |
| `AUTOMATION_NOTIFICATION_CONCURRENCY` | No | `5` | 1–50 |
| `AUTOMATION_SWEEP_INTERVAL_SECONDS` | No | `60` | 15–3600 |
| `AUTOMATION_RENEWAL_REMINDER_WINDOW_DAYS` | No | `7` | 1–30 |
| `AUTOMATION_TRIAL_REMINDER_WINDOW_DAYS` | No | `3` | 1–30 |
| `AUTOMATION_INVOICE_DUE_IN_DAYS` | No | `7` | 0–60 |
| `AUTOMATION_INVOICE_TAX_RATE_BPS` | No | `0` | 0–5000 basis points |
| `AUTOMATION_JOB_MAX_ATTEMPTS` | No | `5` | 1–20 |
| `AUTOMATION_JOB_BACKOFF_BASE_SECONDS` | No | `60` | 10–3600 |
| `AUTOMATION_JOB_BACKOFF_MAX_SECONDS` | No | `3600` | 60–86400 |
| `AUTOMATION_PAYMENT_RETRY_BASE_MINUTES` | No | `60` | 1–10080 |
| `AUTOMATION_PAYMENT_RETRY_MAX_MINUTES` | No | `1440` | 1–43200 |
| `AUTOMATION_PAYMENT_RETRY_MAX_ATTEMPTS` | No | `4` | 1–10 |
| `AUTOMATION_PAYMENT_EXHAUSTION_ACTION` | No | `MARK_PAST_DUE` | `MARK_PAST_DUE` or `CANCEL`; no automatic gateway charge |
| `AUTOMATION_PAST_DUE_EXPIRY_DAYS` | No | `30` | 1–365 |
| `AUTOMATION_WORKER_STALE_SECONDS` | No | `300` | 30–3600; recovery threshold for stale rows |
| `NOTIFICATION_MAX_ATTEMPTS` | No | `5` | 1–20 |
| `NOTIFICATION_RETRY_BASE_SECONDS` | No | `60` | 10–3600 |
| `NOTIFICATION_RETRY_MAX_SECONDS` | No | `3600` | 60–86400 |
| `EMAIL_FROM` | No | `Subscript <no-reply@subscript.local>` | Valid address, optionally with a display name |
| `SMTP_HOST` | No | — | Enables SMTP delivery. Without it, email is logged only |
| `SMTP_PORT` | No | `587` | 1–65535 |
| `SMTP_SECURE` | No | `false` | `true` for implicit TLS |
| `SMTP_USER` | No | — | Must be set with `SMTP_PASSWORD` |
| `SMTP_PASSWORD` | No | — | Must be set with `SMTP_USER`; never logged |

Razorpay values are all-or-nothing. `DATABASE_URL` and a real HTTPS
`CORS_ORIGINS` list are mandatory in production. If `SESSION_COOKIE_NAME` starts
with `__Host-`, the API enforces `COOKIE_SECURE=true` and the cookie is written
with `Path=/` and no `Domain`.

### Production example

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://subscript:REPLACE_ME@db.example.com:5432/subscript?schema=public&sslmode=require
CORS_ORIGINS=https://app.example.com
SESSION_COOKIE_NAME=__Host-subscript_session
COOKIE_SECURE=true
TRUST_PROXY=true
BCRYPT_COST=12
METRICS_TOKEN=REPLACE_WITH_A_LONG_RANDOM_VALUE
LOG_REQUESTS=true
REDIS_URL=rediss://default:REPLACE_ME@redis.example.com:6379
EMAIL_FROM=Subscript <no-reply@example.com>
```

Add the three `RAZORPAY_*` values only when online checkout is enabled. Add the
`SMTP_*` values only when real email delivery is enabled.

## Web

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `VITE_API_URL` | No | `http://localhost:4000` | API base URL. Vite bakes it into the bundle at build time, so rebuild/redeploy after changing it. Use HTTPS in staging and production |

## Secrets management

- Local secrets belong in `apps/server/.env`, which is gitignored.
- CI/CD secrets belong in the platform's environment or secret store.
- Render Blueprint values marked `sync: false` must be filled in the dashboard.
- Vercel: set `VITE_API_URL` in Project → Settings → Environment Variables, then
  redeploy.
- Rotate `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `METRICS_TOKEN`, SMTP
  credentials, and database passwords after any suspected exposure.
- The API never returns secrets in responses and the logger redacts sensitive
  keys, emails, bearer tokens, Razorpay keys, and long tokens. This is a safety
  net, not a substitute for not logging them.
