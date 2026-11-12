# Deployment

Subscript has three deployable pieces:

| Piece | Artifact | Suggested host |
| --- | --- | --- |
| Web SPA | `apps/web/dist` | Vercel, Render Static Site, nginx |
| API | `apps/server/dist/server.js` or `apps/server/Dockerfile` | Render, Fly.io, ECS, Kubernetes |
| Worker | Same image with `node apps/server/dist/worker.js` | Render background worker, Fly process group, Kubernetes worker deployment |

PostgreSQL and Redis should be managed services with backups. Never deploy the
API without `DATABASE_URL`; production rejects a missing database.

## Release order

1. Build and test the release candidate.
2. Back up the database.
3. Run `npm run db:deploy` once against the target database.
4. Deploy the API and worker.
5. Deploy the web app with the final `VITE_API_URL`.
6. Run the post-deploy smoke checks.

Migrations are additive in this release. Do not run the old application against
a schema it does not understand; deploy the matching application version after
the migration. For destructive future migrations, use expand/contract releases.

## Vercel (web)

The repository includes `vercel.json`.

1. Import the repository into Vercel.
2. Framework preset: Vite (the config also declares it).
3. Build command: `npm run build -w @subscript/shared && npm run build -w @subscript/web`.
4. Output directory: `apps/web/dist`.
5. Install command: `npm ci`.
6. Set `VITE_API_URL` to the public API URL for Production (and Preview, if
   desired).
7. Deploy.

`vercel.json` adds the SPA fallback, long-lived asset caching, and security
headers. The rewrite excludes `/assets` and `/favicon.svg`. The web app has no
server-side secrets; `VITE_*` values are public.

If you use a custom domain, set `CORS_ORIGINS` on the API to that exact HTTPS
origin. Do not use wildcards.

## Render (API, worker, static web)

`render.yaml` defines a free-tier blueprint:

- PostgreSQL `subscript-db`
- Redis `subscript-redis`
- Docker web service `subscript-api` with health check `/api/ready`
- Docker worker `subscript-worker`
- Static web service `subscript-web`

Steps:

1. Push the repository to GitHub.
2. In Render, choose **New → Blueprint** and select the repository.
3. Fill the `sync: false` values:
   - API: `CORS_ORIGINS` (the final web origin)
   - Web: `VITE_API_URL` (the final API origin)
   - Optional: Razorpay and SMTP values
4. Apply the blueprint. The API image runs migrations manually; Render does not
   run `db:deploy` automatically. Run it once from a Render shell or a release
   job:

```bash
npm run db:deploy
```

5. Confirm `/api/ready` returns `200` with `status: "ok"` (or `degraded` only if
   Redis is intentionally unavailable).
6. Redeploy the web service after setting `VITE_API_URL` so Vite bakes it in.

Free plans are for evaluation. Raise the database, Redis, API, and worker plans
before production; free services may sleep, have connection limits, or expire.
Set `DB_POOL_MAX` conservatively on small database plans.

The worker uses the API image with a command override:

```text
node apps/server/dist/worker.js
```

It requires `DATABASE_URL` and `REDIS_URL`, which the blueprint supplies.

## Docker

Build from the repository root so the monorepo context is available.

API and worker (one multi-stage image):

```bash
docker build -f apps/server/Dockerfile -t subscript-api .
docker run --rm -p 4000:4000 --env-file apps/server/.env subscript-api
# worker:
docker run --rm --env-file apps/server/.env subscript-api node apps/server/dist/worker.js
```

Web:

```bash
docker build -f apps/web/Dockerfile \
  --build-arg VITE_API_URL=https://api.example.com \
  -t subscript-web .
docker run --rm -p 8080:8080 subscript-web
```

The web image serves with nginx on port 8080, adds security headers, caches
hashed assets, serves `/healthz`, and falls back to `index.html` for client
routes.

The API image runs as the non-root `node` user and includes a `HEALTHCHECK`
against `/api/health`. The worker command must be overridden; its liveness is
the process itself, while queue health is visible through the API and logs.

### Compose

`compose.yaml` is for local PostgreSQL and Redis only. It is not a production
orchestration file. For a self-hosted deployment, put the web and API behind a
TLS-terminating reverse proxy, set `TRUST_PROXY=true`, and keep PostgreSQL and
Redis on private networks.

## Required production environment

At minimum:

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://...
CORS_ORIGINS=https://app.example.com
COOKIE_SECURE=true
SESSION_COOKIE_NAME=__Host-subscript_session
TRUST_PROXY=true
REDIS_URL=redis://...        # API dispatch/health, required by worker
```

Add Razorpay and SMTP values only when those features are enabled. See
[configuration.md](./configuration.md).

The web build needs:

```dotenv
VITE_API_URL=https://api.example.com
```

## Cookies, TLS, and CORS

- Terminate TLS at the load balancer or host platform and forward HTTPS.
- Production requires HTTPS origins and a secure cookie.
- The default production cookie is `__Host-subscript_session`, which requires
  `Secure`, `Path=/`, and no `Domain`. Only change it if your platform cannot
  satisfy those rules.
- Set `TRUST_PROXY=true` only when a trusted proxy sets `X-Forwarded-For` and
  `X-Forwarded-Proto`; otherwise rate limiting and secure-cookie detection can
  be wrong.
- `CORS_ORIGINS` is an exact allowlist. Include the web origin, not the API
  origin, and no trailing slash.

## Health checks and load balancers

| Endpoint | Use |
| --- | --- |
| `/api/health` | Liveness; process is up |
| `/api/ready` | Readiness; PostgreSQL required, Redis optional/degraded |
| `/api/metrics` | Prometheus scrape; requires `METRICS_TOKEN` |

Use liveness for restart decisions and readiness for traffic routing. A
`degraded` readiness response is still `200`; route traffic but alert on the
condition. A `503` means PostgreSQL is unavailable.

Set load-balancer idle timeouts slightly above the API keep-alive timeout
(default 5 seconds) to avoid races that produce sporadic 502s.

## Graceful shutdown

On `SIGTERM`/`SIGINT` the API stops accepting connections, closes idle
connections, waits for in-flight requests up to `SHUTDOWN_TIMEOUT_MS`, then
closes Redis and Prisma. The worker closes BullMQ consumers, waits for active
jobs, then closes Prisma. Give orchestrators a termination grace period longer
than `SHUTDOWN_TIMEOUT_MS` (for example 30 seconds).

## Scaling

- API: stateless; scale horizontally. Sessions live in PostgreSQL.
- Worker: safe to scale horizontally; claims are atomic. Keep the same queue
  prefix.
- Web: static; scale via CDN.
- PostgreSQL: size the pool as described in [database.md](./database.md).
- Redis: use a managed instance with persistence. Redis loss does not lose
  durable jobs, but it increases re-dispatch work.

## Rollback

1. Roll back the application to the previous image/build.
2. Prefer forward-compatible migrations; do not reverse a migration that has
   already written data unless you have a tested down path.
3. If a migration must be reversed, restore from the pre-deploy backup or apply
   a new corrective migration. Never edit an applied migration.
4. Re-run smoke checks and inspect `/api/ready`, error rates, and queue health.

## Post-deploy smoke checks

```bash
curl -fsS https://api.example.com/api/health
curl -fsS https://api.example.com/api/ready
curl -fsS https://app.example.com/ | head
```

Then in a browser:

1. Register or sign in.
2. List customers and open a record.
3. Create a plan and start a subscription (staging only).
4. Generate an invoice and open the print view.
5. Open Analytics and download a CSV.
6. Open Operations and confirm worker/queue health.
7. If Razorpay is configured, run a Test Mode checkout and a signed webhook
   delivery.

## CI/CD notes

`.github/workflows/ci.yml` validates lint, types, tests, build, Prisma, audit,
PostgreSQL/Redis integration, and Playwright. Connect your host to the repository
only after CI is green. Run migrations as a separate release step, not from
every API replica. Keep deployment secrets in the platform, never in the
repository.
