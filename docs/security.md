# Security

This document records the Phase 8 security review, the controls now enforced,
and the residual risks that require product or operational decisions.

The review was an internal code and configuration audit. It is not a substitute
for an independent penetration test or a compliance certification.

## Scope

Reviewed:

- Authentication, registration, sessions, cookies, password handling
- Organization membership, roles, tenant isolation, and session switching
- CSRF, XSS, SQL injection, request validation, and response safety
- Rate limiting, CORS, security headers, and proxy behavior
- CSV export and file-related output
- Razorpay checkout, verification, webhooks, refunds, and idempotency
- Secrets, environment validation, logging, and API error responses
- Database pooling, timeouts, migrations, and health checks
- Worker recovery, Redis failure, graceful shutdown, and deployment defaults

## Findings fixed in Phase 8

| Area | Change |
| --- | --- |
| Production cookies | `__Host-subscript_session` by default; production requires `COOKIE_SECURE=true`; `Priority=High` added |
| Production CORS | Missing or HTTP origins are rejected when `NODE_ENV=production` |
| CSRF | Origin guard rejects `Origin: null` and `Sec-Fetch-Site: cross-site` on unsafe methods, in addition to SameSite cookies and CORS |
| Rate limiting | Global limiter on `/api` (default 600/min); health, readiness, and metrics stay outside it; auth, gateway, and webhook limits remain |
| Security headers | Explicit Helmet configuration, HSTS in production, no `X-Powered-By`, no ETags, `no-store` on all API responses |
| JSON responses | `json escape` enabled so reflected values cannot become markup if a browser sniffs the payload |
| Session tokens | Length and character-set validation before lookup; malformed cookies are ignored without a database call |
| Passwords | bcrypt cost 10–14; unknown-email login compares against a dummy hash; password byte limits enforced by validation |
| Request tracing | Caller request IDs and correlation IDs are validated and bounded; unsafe values are replaced |
| SQL injection | Prisma parameterization; analytics raw SQL uses `Prisma.sql` parameters and static identifiers |
| CSV injection | Cells beginning with formula characters or leading whitespace are prefixed with an apostrophe |
| Webhooks | Raw-body HMAC verification, timing-safe comparison, required event ID, unique deduplication, replay-safe processing |
| Secrets | Startup validation, live-key gate outside production, no secrets or raw payloads in logs or API responses |
| Logging | Structured JSON with email, bearer-token, Razorpay-key, and long-token redaction; no stacks in production |
| Metrics endpoint | Hidden unless `METRICS_TOKEN` is set; constant-time bearer-token comparison |
| Database | Bounded pool, connection/idle timeouts, `statement_timeout`, UTC sessions, pool error logging |
| HTTP server | Explicit request, headers, keep-alive, and shutdown timeouts; graceful shutdown |
| Worker | Heartbeats, stale-job recovery, bounded retries, independent process, graceful shutdown |
| Dependencies | `npm audit`: 0 critical/high; 10 moderate findings in development tooling only |

## Authentication and sessions

- Passwords are hashed with bcrypt at cost 12 by default.
- Session tokens are 32 random bytes. Only the SHA-256 hash is stored.
- The raw token lives in an HttpOnly, SameSite=Lax cookie. It is never returned
  in JSON or written to browser storage.
- Production cookies are `Secure`, `Path=/`, and `__Host-` prefixed.
- Logout revokes the session server-side and clears the cookie.
- Sessions expire after `SESSION_TTL_DAYS` (default 7); expired rows are rejected.
- Session resolution re-checks the user and active organization on every
  protected request, so revoked memberships take effect immediately.

## Authorization and tenant isolation

- Roles: `OWNER`, `ADMIN`, `MEMBER`.
- Reads are available to members; billing and catalogue mutations require owner
  or admin.
- Every protected query is scoped by the session's active organization.
- Cross-tenant IDs resolve as `404`; switching to a non-member organization
  returns `403`.
- Organization renaming requires owner or admin.
- Automation retry and dispatch require owner or admin; reads are member-safe.
- Workers process organization-scoped rows and never trust a client-supplied
  organization ID.

## Input and output safety

- Zod schemas validate bodies, params, and queries; unknown fields are rejected
  where the contract requires it.
- Request bodies are limited to 64 KB and must be valid JSON for non-webhook
  routes.
- React escapes rendered values. The API also enables JSON escaping.
- The API serves JSON only; the web app ships a CSP through nginx, Vercel, or
  Render headers.
- CSV exports escape delimiters, quotes, and newlines and neutralize spreadsheet
  formulas.
- Error responses use a single envelope and omit stack traces, SQL, provider
  payloads, and internal messages.
- The API disables ETags and sets `Cache-Control: no-store` on `/api`.

## CSRF and CORS

- CORS allows only configured exact origins with credentials.
- Unsafe methods reject `Origin: null` and `Sec-Fetch-Site: cross-site`.
- Cookies are SameSite=Lax, which blocks cross-site unsafe requests in modern
  browsers.
- Non-browser clients that omit `Origin` are still allowed; they do not carry a
  victim's cookies.
- Production requires HTTPS origins.

## Rate limits

| Scope | Default |
| --- | --- |
| Global `/api` | 600 requests/minute per client |
| Login | 20 failed attempts/15 minutes |
| Registration | 20 attempts/15 minutes |
| Gateway actions | 30 requests/minute |
| Razorpay webhooks | 120 requests/minute |

`express-rate-limit` uses an in-process memory store. Limits are per API
replica, not global. For strict global limits, put a shared limiter at the edge
or use a shared store. Do not expose the API without TLS or a trusted proxy.

## Razorpay security

- Amount and currency come from the invoice, never the browser.
- Checkout reserves a pending payment before ordering, preventing duplicate
  orders.
- Verification checks the HMAC signature, re-fetches the provider payment, and
  checks order, amount, currency, and captured status.
- Webhooks verify the raw-body signature with a timing-safe comparison and
  require a provider event ID.
- Provider event IDs are unique per provider; duplicates are acknowledged
  without reapplying changes.
- Refunds reserve their amount before calling the provider; pending
  reservations prevent over-refunds.
- Live keys are rejected outside production.
- Secrets, signatures, and raw payloads are never logged or returned.

## Logging and privacy

- Logs are JSON with level, message, timestamp, and structured context.
- Sensitive keys (`password`, `token`, `authorization`, `cookie`, `secret`,
  `apiKey`, card fields, and similar) are replaced with `[redacted]`.
- Emails, bearer tokens, Razorpay keys, and long tokens are redacted from text.
- Request logs exclude bodies and query strings; user and organization IDs are
  optional fields and are not emitted for operational endpoints.
- Production logs omit stack traces.
- Webhook payloads, notification bodies, SMTP credentials, and session tokens
  are never logged.

## Database and infrastructure

- Connections use a bounded pool and a server-side statement timeout.
- Sessions are pinned to UTC to avoid timestamp shifts.
- Health checks are read-only and time-bounded.
- Production requires PostgreSQL; memory stores are development/test only.
- Migrations are committed and applied with `db:deploy`; production never uses
  `db:push` or `migrate reset`.
- The API and worker run as separate processes with independent failure domains.
- Containers run as a non-root user; the web image adds security headers.
- Graceful shutdown drains in-flight work.

## Dependency supply chain

- `npm audit` currently reports 0 critical and 0 high vulnerabilities; the 10
  moderate findings are in development-only ESLint/minimatch tooling.
- Run `npm audit` in CI with `--audit-level=high`.
- Review lockfile changes in pull requests.
- Pin Node to a supported LTS (22+) and rebuild images regularly.
- Do not add packages that execute untrusted install scripts without review.

## Residual risks

| Risk | Status / mitigation |
| --- | --- |
| No MFA, SSO, or passkeys | Product gap; enforce strong passwords and monitor login failures |
| No member invitation or role-change flow | Only registration and the existing roster are exposed |
| Rate limits are per replica | Use an edge limiter or shared store for strict global limits |
| No dedicated CSRF token | SameSite=Lax + origin guard + CORS is the current defense; add tokens if supporting legacy browsers |
| No WAF or bot protection | Put the API behind a managed WAF/CDN if exposed publicly |
| No external penetration test | Schedule one before handling sensitive production data |
| Live Razorpay flow not exercised by automated tests | Run the Test Mode checklist and a small live transaction before launch |
| Redis is optional for readiness | Alert on `degraded`; automation is unavailable while Redis is down |
| In-process metrics are lost on restart | Scrape continuously; use a managed metrics backend |
| Development-only moderate advisories | Track upstream fixes; do not ship dev dependencies to production |

## Deployment checklist

- [ ] `NODE_ENV=production`
- [ ] HTTPS end to end; HTTP redirects at the edge
- [ ] `DATABASE_URL` uses TLS if required by the provider
- [ ] `CORS_ORIGINS` lists exact HTTPS origins only
- [ ] `COOKIE_SECURE=true` and `__Host-` cookie name
- [ ] `TRUST_PROXY=true` only behind a trusted proxy
- [ ] Strong, unique `METRICS_TOKEN`
- [ ] Razorpay live keys and a new webhook secret; live mode verified
- [ ] SMTP credentials scoped to sending only
- [ ] Database backups and PITR enabled
- [ ] `/api/ready`, logs, metrics, and queue health monitored
- [ ] Rate limits and timeouts reviewed for expected traffic
- [ ] Dependency audit reviewed
- [ ] Incident and secret-rotation runbooks available

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Contact the
maintainers privately with:

- A description of the issue and affected version
- Reproduction steps or a proof of concept
- Impact assessment
- Any suggested remediation

Do not access, modify, or exfiltrate data that is not yours. Allow time for a
fix before disclosure.
