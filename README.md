# Subscript

Subscript is a multi-tenant subscription and revenue management platform. Phase 6 adds durable background automation: Redis + BullMQ workers schedule renewals, trial conversion, recurring invoices, period-end cancellation, status synchronization, payment recovery reminders, and notification delivery with bounded retries and an operations console. Phase 5 added Razorpay online payments behind a provider-independent gateway: checkout for open invoices, signed webhook reconciliation, and full or partial refunds alongside the existing manual payment records.

Authentication, sessions, organization membership, customers, plans, subscriptions, invoices, payments, gateway transactions, and automation jobs are live and enforced by the API. The revenue dashboard still uses illustrative data.

## Payment scope

Subscript supports two payment paths that share one billing ledger:

- **Manual** payments record cash, bank transfer, check, or other offline collections.
- **Gateway** payments use Razorpay Checkout for open invoices. The server creates the provider order, verifies the checkout signature, and only changes balances after the provider confirms capture. Signed webhooks reconcile captures, failures, order payments, and refunds even if the browser closes mid-payment.

With no Razorpay credentials, the gateway is disabled and only manual recording is available. Configure Test Mode keys to exercise checkout locally; live keys are rejected outside production.

## Stack

- **Web:** React 19, TypeScript, Vite, Tailwind CSS 4, React Router
- **Server:** Node.js, Express 5, TypeScript, Zod, Helmet, CORS
- **Auth:** bcrypt password hashing, opaque cookie sessions, SHA-256 token hashes
- **Data:** PostgreSQL, Prisma 7 (`prisma-client` + `@prisma/adapter-pg`)
- **Automation:** Redis, BullMQ, durable PostgreSQL job outbox, notification provider abstraction
- **Email:** development log adapter by default; optional SMTP through Nodemailer
- **Shared:** `@subscript/shared` domain types and HTTP contracts
- **Tooling:** npm workspaces, ESLint, Vitest, strict TypeScript

## Features

- Register, login, logout, and current-session endpoints
- Registration creates a user, their first organization, an owner membership, and a session atomically
- HttpOnly, SameSite cookies; no session token is readable by browser JavaScript
- Session tokens are stored in the database only as SHA-256 hashes
- Organization roles: `OWNER`, `ADMIN`, `MEMBER`
- Organization-scoped authorization middleware with a fresh membership check on every protected request
- Active organization stored on the session and switched only after a membership check
- Protected and guest-only routes, session restoration, and useful loading/error states
- Workspace switcher for users who belong to more than one organization
- Team settings page with workspace profile, member roster, and role visibility
- Customer and plan catalogues with archive/restore, search, filters, sorting, and per-record activity history
- Subscription creation from an active customer and plan, with a plan price snapshot, quantity, trial override, and optional first-period end
- Centralized subscription lifecycle: create, trial, activate, pause, resume, cancel at period end, cancel immediately, renew, mark past due, and expire
- Invoice generation for the current period with configurable tax in basis points, due dates, customer snapshot, and line items
- Invoice lifecycle: draft, issue, void, mark uncollectible, and paid status derived from successful payments
- Manual payment records with methods, references, notes, partial payments, pending attempts, success, failure, and refunds
- Razorpay Checkout for `OPEN` invoices, with server-derived amount and currency, duplicate-attempt protection, and cancellation recovery
- Server-side HMAC-SHA256 checkout verification plus signed, deduplicated, retry-safe webhooks for captures, failures, order payments, and refunds
- Full and partial gateway refunds with pending reservations, over-refund rejection, and provider-driven reconciliation
- Transactional balance updates and idempotent invoice generation; duplicate invoices per subscription period and overpayments are rejected
- Printable invoice view with print CSS for browser print or save-as-PDF
- Redis + BullMQ background workers in a separate process, with durable `AutomationJob` rows written before enqueue and idempotency keys for every scheduled action
- Scheduled renewal reminders, trial-ending notices, trial activation and invoicing, recurring invoices, cancel-at-period-end, status synchronization, and past-due expiration
- Payment recovery reminders with configurable exponential bounded backoff, attempt limits, and an explicit `MARK_PAST_DUE` or `CANCEL` exhaustion rule; no automatic gateway charge is ever initiated
- Deduplicated customer notifications with an email provider abstraction, development log adapter, optional SMTP, delivery attempts, retries, and dead-letter status
- Operations page for queue/worker health, upcoming renewals, job execution history, notification history, and owner/admin retry and dispatch controls
- Transactional outbox behavior, per-job atomic claims, stale running/queued recovery, crash-safe reprocessing, and structured job logs without raw payloads or secrets
- Auth rate limiting, strict request validation, an Origin guard for unsafe methods, and a consistent API error envelope
- Web tests for form validation, identity helpers, and billing helpers; API tests for billing math, lifecycle transitions, invoices, payments, concurrency, tenancy, roles, auth, rate limiting, automation scheduling, retries, and notification deduplication

## Structure

```text
subscript/
├── apps/
│   ├── web/                    React dashboard
│   │   ├── public/
│   │   └── src/
│   │       ├── app/            Router and error boundary
│   │       ├── auth/           Auth context, route guards, form validation
│   │       ├── components/
│   │       │   ├── auth/       Auth layout and session status screens
│   │       │   ├── dashboard/  Metrics, chart, activity, renewals
│   │       │   ├── layout/     Sidebar, topbar, workspace switcher, shell
│   │       │   └── ui/         Buttons, cards, badges, fields, states
│   │       ├── data/           Illustrative revenue data
│   │       ├── hooks/
│   │       ├── lib/            API client, billing helpers, validation, money
│   │       ├── pages/          Customers, plans, subscriptions, invoices, print
│   │       └── styles/
│   └── server/                 Express API
│       ├── prisma/
│       │   ├── migrations/     Auth, catalogue, and billing migrations
│       │   └── schema.prisma
│       ├── src/
│       │   ├── auth/           Service, stores, password/session helpers
│       │   ├── billing/        Centralized lifecycle state machines and errors
│       │   ├── config/         Environment validation
│       │   ├── customers/      Validation, stores, serializer, router
│       │   ├── db/             Prisma client factory
│       │   ├── errors/
│       │   ├── gateway/        Provider-neutral gateway, Razorpay adapter, webhook reconciliation
│       │   ├── invoices/       Invoice/payment validation, stores, router
│       │   ├── lib/
│       │   ├── middleware/     Auth, tenancy, roles, rate limits, errors
│       │   ├── plans/          Validation, stores, serializer, router
│       │   ├── routes/
│       │   ├── subscriptions/  Validation, stores, serializer, router
│       │   ├── types/
│       │   ├── app.ts
│       │   └── server.ts
│       └── tests/
├── packages/
│   └── shared/                 Shared types and contracts
├── compose.yaml                Optional local PostgreSQL
└── package.json                Workspace scripts
```

## Prerequisites

- Node.js **22.12+** (developed on Node 24)
- npm **10+**
- PostgreSQL 15+ and Redis 7+ only when exercising the Prisma-backed runtime and background workers

Frontend development, linting, tests, typechecks, and builds do not require a running database or Redis. Local development without `DATABASE_URL` uses in-memory stores for auth, customers, plans, subscriptions, invoices, and payments. Background automation requires PostgreSQL for durable jobs and Redis for BullMQ transport.

## Setup

```bash
npm install

# optional environment files
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

On Windows PowerShell:

```powershell
Copy-Item apps/server/.env.example apps/server/.env
Copy-Item apps/web/.env.example apps/web/.env
```

`npm install` also runs `prisma generate`, which writes the Prisma client into `apps/server/src/generated/prisma` (gitignored).

### Local PostgreSQL and Redis (optional)

If Docker is available:

```bash
docker compose up -d
```

Uncomment `DATABASE_URL` in `apps/server/.env`, then apply the committed migration:

```bash
npm run db:migrate
```

The Compose defaults use user `subscript`, password `subscript_dev`, database `subscript`, and Redis on `localhost:6379`. Adjust connection strings for existing services.

### Background workers (optional)

Automation is split into two processes so API latency and background retries are independent:

```bash
# terminal 1
npm run dev

# terminal 2, after DATABASE_URL and REDIS_URL are set
npm run dev:worker -w @subscript/server
```

The API starts without Redis and reports automation as disabled on the Operations page. The worker refuses to start unless both `DATABASE_URL` and `REDIS_URL` are present. Workers install a BullMQ job scheduler, run an immediate sweep on startup, refresh a heartbeat every 20 seconds, and recover stale jobs and notifications left by a crashed or restarted process.

### Development without PostgreSQL

Leave `DATABASE_URL` commented out. The API uses in-memory stores so registration, login, workspace switching, sessions, catalogues, subscriptions, invoices, and payments can be exercised locally. The stores reset whenever the API restarts and are never used in production. Production requires `DATABASE_URL` and always uses Prisma.

### Razorpay Test Mode (optional)

Online checkout stays disabled until all three Razorpay values are set. To exercise it locally:

1. Create a Razorpay account and switch the dashboard to **Test Mode**.
2. Generate a Test Key ID and Key Secret under **Account & Settings → API Keys**.
3. Choose a webhook secret and create a webhook under **Account & Settings → Webhooks** pointing at `https://<your-public-api>/api/webhooks/razorpay`. Subscribe to `payment.captured`, `payment.failed`, `order.paid`, `refund.created`, `refund.processed`, and `refund.failed`.
4. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in `apps/server/.env`.

For local webhook testing, expose the API with a tunnel such as ngrok and use the public HTTPS URL. The API verifies the raw request body, so do not let a proxy rewrite it. Test keys (`rzp_test_…`) are accepted in development and test; live keys (`rzp_live_…`) are rejected unless `NODE_ENV=production`. No real charge occurs in Test Mode.

## Run

```bash
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000
- Health: http://localhost:4000/api/health

Open `/register` first to create a user and workspace, or `/login` for an existing account. Unauthenticated visitors to protected routes are redirected to `/login`, then returned to their original destination after signing in.

### Production-style preview

```bash
npm run build
npm run preview -w @subscript/web
```

Start the API in a second terminal with `npm run start -w @subscript/server` after building the server. In production, set `NODE_ENV=production`, `DATABASE_URL`, a real `CORS_ORIGINS` list, and serve the API over HTTPS so the session cookie is marked `Secure`.

## Environment

### Server (`apps/server/.env`)

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | `development`, `test`, or `production` |
| `PORT` | No | `4000` | Validated 1-65535 |
| `DATABASE_URL` | Production | — | Must use `postgresql://` or `postgres://`; in development, absence enables the memory auth store |
| `CORS_ORIGINS` | Production | `http://localhost:5173,http://localhost:4173` | Comma-separated origins; wildcards and paths rejected |
| `SESSION_TTL_DAYS` | No | `7` | Validated 1-30 days |
| `BCRYPT_COST` | No | `12` | Validated 10-14 |
| `COOKIE_SECURE` | No | `true` in production, `false` otherwise | Set explicitly when terminating TLS elsewhere |
| `TRUST_PROXY` | No | `false` | Set to `true` only behind a trusted reverse proxy |
| `RAZORPAY_KEY_ID` | Gateway | — | Test or live publishable key; must start with `rzp_test_` or `rzp_live_` |
| `RAZORPAY_KEY_SECRET` | Gateway | — | Secret API key; never exposed to the browser or logs |
| `RAZORPAY_WEBHOOK_SECRET` | Gateway | — | Verifies the `X-Razorpay-Signature` header on webhook deliveries |
| `REDIS_URL` | Worker | — | `redis://` or `rediss://`; workers also require `DATABASE_URL`. The API starts without it and reports automation disabled |
| `AUTOMATION_QUEUE_PREFIX` | No | `subscript` | BullMQ namespace and heartbeat key prefix |
| `AUTOMATION_BILLING_CONCURRENCY` | No | `5` | Billing worker concurrency (1-50) |
| `AUTOMATION_NOTIFICATION_CONCURRENCY` | No | `5` | Notification worker concurrency (1-50) |
| `AUTOMATION_SWEEP_INTERVAL_SECONDS` | No | `60` | Cluster-wide sweep cadence (15-3600) |
| `AUTOMATION_RENEWAL_REMINDER_WINDOW_DAYS` | No | `7` | Renewal reminder and operations window |
| `AUTOMATION_TRIAL_REMINDER_WINDOW_DAYS` | No | `3` | Trial-ending reminder window |
| `AUTOMATION_INVOICE_DUE_IN_DAYS` | No | `7` | Due date for automatically generated invoices |
| `AUTOMATION_INVOICE_TAX_RATE_BPS` | No | `0` | Tax rate in basis points for automatic invoices |
| `AUTOMATION_JOB_MAX_ATTEMPTS` | No | `5` | Bounded retry limit for scheduled jobs |
| `AUTOMATION_JOB_BACKOFF_BASE_SECONDS` | No | `60` | Exponential backoff base |
| `AUTOMATION_JOB_BACKOFF_MAX_SECONDS` | No | `3600` | Backoff ceiling |
| `AUTOMATION_PAYMENT_RETRY_BASE_MINUTES` | No | `60` | Payment recovery backoff base |
| `AUTOMATION_PAYMENT_RETRY_MAX_MINUTES` | No | `1440` | Payment recovery backoff ceiling |
| `AUTOMATION_PAYMENT_RETRY_MAX_ATTEMPTS` | No | `4` | Recovery reminder attempts before exhaustion |
| `AUTOMATION_PAYMENT_EXHAUSTION_ACTION` | No | `MARK_PAST_DUE` | `MARK_PAST_DUE` or `CANCEL`; no gateway charge is attempted |
| `AUTOMATION_PAST_DUE_EXPIRY_DAYS` | No | `30` | Grace period before past-due expiration |
| `AUTOMATION_WORKER_STALE_SECONDS` | No | `300` | Running/queued rows older than this are recovered |
| `NOTIFICATION_MAX_ATTEMPTS` | No | `5` | Email delivery attempts before dead-letter |
| `NOTIFICATION_RETRY_BASE_SECONDS` | No | `60` | Notification backoff base |
| `NOTIFICATION_RETRY_MAX_SECONDS` | No | `3600` | Notification backoff ceiling |
| `EMAIL_FROM` | No | `Subscript <no-reply@subscript.local>` | Sender address, optionally with display name |
| `SMTP_HOST` | No | — | Enables SMTP delivery; without it email is logged only |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_SECURE` | No | `false` | `true` for implicit TLS |
| `SMTP_USER` | No | — | Must be supplied with `SMTP_PASSWORD` |
| `SMTP_PASSWORD` | No | — | Never logged or returned by the API |

Razorpay variables must be supplied together. Leaving all three unset disables online checkout. Live keys are rejected unless `NODE_ENV=production`; Test Mode is the default for local development.

Environment validation fails fast at API startup with readable issues. Internal error details are logged but never returned to clients.

### Web (`apps/web/.env`)

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `VITE_API_URL` | No | `http://localhost:4000` | API base URL; all auth requests use `credentials: "include"` |

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create a user, first organization, owner membership, and session |
| `POST` | `/api/auth/login` | Verify credentials and issue a fresh session |
| `POST` | `/api/auth/logout` | Revoke the current session and clear the cookie |
| `GET` | `/api/auth/me` | Return the authenticated user, organizations, and active organization |
| `GET` | `/api/organizations/current` | Return the active organization, role, and member roster |
| `PATCH` | `/api/organizations/current` | Rename the active organization (owner or admin) |
| `POST` | `/api/organizations/:organizationId/switch` | Switch the session's active organization after a membership check |
| `GET` | `/api/customers` | List organization customers with search, status, sort, and paging |
| `POST` | `/api/customers` | Create a customer (owner or admin) |
| `GET` | `/api/customers/:customerId` | Customer detail with activity history |
| `PATCH` | `/api/customers/:customerId` | Update a customer (owner or admin) |
| `POST` | `/api/customers/:customerId/archive` | Archive a customer |
| `POST` | `/api/customers/:customerId/restore` | Restore an archived customer |
| `GET` | `/api/plans` | List plans with search, status, interval, sort, and paging |
| `POST` | `/api/plans` | Create a plan (owner or admin) |
| `GET` | `/api/plans/:planId` | Plan detail with activity and usage |
| `PATCH` | `/api/plans/:planId` | Update a plan |
| `POST` | `/api/plans/:planId/archive` | Archive a plan |
| `POST` | `/api/plans/:planId/restore` | Restore an archived plan |
| `DELETE` | `/api/plans/:planId` | Permanently delete an unused plan |
| `GET` | `/api/subscriptions` | List subscriptions with search, status, sort, and paging |
| `POST` | `/api/subscriptions` | Start a subscription from an active customer and plan |
| `GET` | `/api/subscriptions/:subscriptionId` | Subscription detail, invoices, payments, and timeline |
| `POST` | `/api/subscriptions/:subscriptionId/pause` | Pause an active subscription |
| `POST` | `/api/subscriptions/:subscriptionId/resume` | Resume a paused subscription |
| `POST` | `/api/subscriptions/:subscriptionId/cancel` | Cancel at period end or immediately |
| `POST` | `/api/subscriptions/:subscriptionId/renew` | Convert a trial or advance a paid period |
| `POST` | `/api/subscriptions/:subscriptionId/expire` | Expire a subscription |
| `POST` | `/api/subscriptions/:subscriptionId/mark-past-due` | Mark a live subscription past due |
| `POST` | `/api/subscriptions/:subscriptionId/activate` | Reactivate a past-due subscription after settlement |
| `POST` | `/api/subscriptions/:subscriptionId/invoices` | Generate (or return) the invoice for the current period |
| `GET` | `/api/invoices` | List invoices with search, status, customer/subscription filters, sort, and paging |
| `GET` | `/api/invoices/:invoiceId` | Invoice detail with line items, payments, and timeline |
| `POST` | `/api/invoices/:invoiceId/issue` | Move a draft invoice to open |
| `POST` | `/api/invoices/:invoiceId/void` | Void an unpaid invoice without deleting it |
| `POST` | `/api/invoices/:invoiceId/mark-uncollectible` | Write off an unpaid invoice |
| `POST` | `/api/invoices/:invoiceId/payments` | Record a manual pending or succeeded payment |
| `POST` | `/api/payments/:paymentId/succeed` | Confirm a pending payment |
| `POST` | `/api/payments/:paymentId/fail` | Mark a pending payment failed |
| `POST` | `/api/payments/:paymentId/refund` | Refund a succeeded manual payment |
| `GET` | `/api/gateway/config` | Report whether online checkout is configured and in test mode |
| `POST` | `/api/invoices/:invoiceId/checkout` | Reserve a gateway payment and create a Razorpay order for an open invoice |
| `POST` | `/api/payments/:paymentId/gateway/verify` | Verify a Checkout signature and apply a captured payment |
| `POST` | `/api/payments/:paymentId/gateway/cancel` | Release a pending checkout reservation after the modal closes |
| `POST` | `/api/payments/:paymentId/gateway/refund` | Create a full or partial gateway refund |
| `POST` | `/api/webhooks/razorpay` | Receive signed Razorpay events with persistent deduplication |
| `GET` | `/api/automation/overview` | Organization-scoped queue health, summary counts, and upcoming renewals |
| `GET` | `/api/automation/jobs` | List scheduled job history with status/type filters and paging |
| `POST` | `/api/automation/jobs/:jobId/retry` | Retry a failed or dead-letter job (owner or admin) |
| `GET` | `/api/automation/notifications` | List notification delivery history with filters and paging |
| `POST` | `/api/automation/notifications/:notificationId/retry` | Retry a failed or dead-letter notification (owner or admin) |
| `POST` | `/api/automation/dispatch` | Dispatch due durable jobs and notifications to BullMQ (owner or admin) |

Successful auth responses set the `subscript_session` cookie and use `Cache-Control: no-store`. The raw token exists only in the cookie; JSON responses never contain session tokens or password hashes.

Errors use one envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request failed validation.",
    "requestId": "6e5f98e6-...",
    "details": [{ "path": "email", "message": "Enter a valid email address." }]
  }
}
```

Every response carries an `X-Request-Id`.

## Billing engine

### Subscriptions

A subscription always belongs to one organization and references a customer and a plan from that same organization. Creation copies the plan's unit price and interval into the subscription, so later plan edits never rewrite historical pricing. The request supplies the start date, quantity, optional trial override, and optional first-period end; the plan supplies the default trial length and interval.

Statuses are `TRIALING`, `ACTIVE`, `PAST_DUE`, `PAUSED`, `CANCELED`, and `EXPIRED`. Transitions are centralized in one state machine and every mutation re-reads the current status while locking the row. Invalid or duplicate transitions return a conflict instead of silently succeeding.

- A trial sets the current period start to the trial end and reports that trial end as the next billing date.
- Renewing from `TRIALING` activates without advancing the period; renewing from `ACTIVE` or `PAST_DUE` advances the period by the plan interval using calendar-aware month-end and leap-year handling.
- Canceling at period end schedules the cancellation; the next renewal converts the subscription to `CANCELED`.
- Pause is available only from `ACTIVE`, and resume only from `PAUSED`.
- Expiring is irreversible. Issued invoices and completed payments are never deleted.

### Invoices

Invoices are generated from the subscription's current period. Generation accepts a tax rate in basis points and a due window, then snapshots the customer's billing details. The line item uses the subscription's unit price snapshot and quantity. Invoice numbers are sequential per organization (`INV-000001`) and allocated inside the same transaction that creates the invoice.

Generating for the same subscription period is idempotent: an existing invoice is returned with `created: false`. A database unique constraint on `(subscriptionId, periodStart, periodEnd)` and a second on `(organizationId, number)` protect concurrent requests. Generation is limited to `TRIALING`, `ACTIVE`, and `PAST_DUE` subscriptions.

Invoices start as `DRAFT`. Issuing moves them to `OPEN` and stamps the issue and due dates. Voiding and marking uncollectible retain the full record for audit. A paid status is derived from successful payments; the invoice amount due is recomputed from its payments inside the same transaction.

### Payments

Payments keep `MANUAL` and `GATEWAY` attempts in one ledger. Manual payments support cash, bank transfer, card, check, and other methods, and may be recorded as `PENDING` or `SUCCEEDED`. Pending attempts can later be confirmed or failed. Gateway payments are created only through checkout and are controlled by provider events; the manual succeed, fail, and refund endpoints reject them. Failed attempts and pending reservations never reduce the balance.

### Razorpay checkout

`POST /api/invoices/:invoiceId/checkout` is available to owners and admins for an `OPEN` invoice with a positive balance. The server derives the amount and currency from the invoice, locks the invoice row, and reserves a `PENDING` gateway payment before calling Razorpay. This prevents two simultaneous checkout orders for the same invoice. An abandoned reservation older than 30 minutes can be replaced on the next attempt.

The browser opens Razorpay Checkout with the returned order ID and publishable key. On success, `POST /api/payments/:paymentId/gateway/verify` receives the order ID, gateway payment ID, and signature. The server verifies the HMAC-SHA256 checkout signature with the key secret, fetches the provider payment, and checks the order, amount, currency, and captured status before applying any balance change. A frontend success callback alone never marks an invoice paid.

If the customer closes the modal, `POST /api/payments/:paymentId/gateway/cancel` marks the local attempt `FAILED` and frees the invoice for a new attempt. A verified webhook can still settle that attempt if the provider captured it despite the closed modal. Duplicate checkout clicks and repeated verification calls are idempotent.

### Razorpay webhooks

`POST /api/webhooks/razorpay` is mounted before the global JSON parser so it receives the exact raw body. The server verifies `X-Razorpay-Signature` against `RAZORPAY_WEBHOOK_SECRET`, requires `X-Razorpay-Event-Id`, normalizes the provider payload, and processes only `payment.captured`, `payment.failed`, `order.paid`, `refund.created`, `refund.processed`, and `refund.failed`.

Each provider event ID is persisted before processing. A completed delivery returns `200 {"status":"duplicate"}` without reapplying the change; a concurrent duplicate receives `409` so Razorpay retries later. Failed processing is recorded and can be retried. Events are matched by internal IDs in notes, provider order ID, and provider payment or refund ID, so out-of-order deliveries are safe:

- Capture is terminal. A late `payment.failed` for a captured payment is ignored.
- A failed attempt can be recovered by a later capture under the same order, including a different provider payment ID.
- A processed refund is terminal; a later failure event is ignored. A failure before processing releases the reservation.

Unsupported events return `200 {"status":"ignored"}`; malformed payloads, bad signatures, and missing event IDs return `400`.

### Refunds

Gateway refunds support full and partial amounts. `POST /api/payments/:paymentId/gateway/refund` reserves the requested amount in a `PENDING` refund ledger entry, then calls Razorpay. Pending reservations count against the refundable balance, so concurrent requests cannot over-refund. A full refund sets the payment to `REFUNDED`; partial refunds update `refundedAmountMinor`. The invoice balance and status are recomputed in the same transaction.

A `processed` provider response settles the refund immediately. A `pending` response stays `PENDING` until a signed webhook settles it. If the provider explicitly rejects the request (4xx), the reservation is marked `FAILED` and the balance is released. If the outcome is uncertain (network error, timeout, or 5xx), the reservation stays `PENDING` to avoid issuing a duplicate refund; refresh the invoice and wait for the provider webhook before retrying. Provider-originated refunds created in the Razorpay dashboard are also reconciled into the ledger.

### Auditing and tenant safety

Every subscription and invoice mutation appends an activity record with the acting user. All queries are organization-scoped; client-supplied organization IDs, totals, currencies, and statuses are never trusted. Billing writes for administrators are restricted to `OWNER` and `ADMIN`, while members can read records in their workspace.

## Background automation

Automation uses PostgreSQL as the durable source of truth and Redis/BullMQ as transport. Scheduling a job writes an `AutomationJob` row with a unique idempotency key before any queue entry exists. BullMQ job IDs include the database job ID, dispatch generation, and timestamp, so a crash between insert and enqueue is safe: the next sweep dispatches the same durable row, and duplicate deliveries find the row already claimed or completed. Notifications use the same insert-first approach with a unique `dedupeKey`.

### Scheduled work

Each sweep evaluates organization-scoped subscriptions and recent payment events:

- **Renewal reminders** for active subscriptions inside the configurable window.
- **Trial-ending reminders** before a trial converts.
- **Trial activation** at trial end: generate the first invoice idempotently, activate the subscription, and notify the customer.
- **Recurring invoices** when an active period ends, followed by a period advance using the centralized lifecycle state machine.
- **Cancel at period end** for scheduled cancellations.
- **Status synchronization** for past-due subscriptions whose outstanding balance reaches zero.
- **Subscription expiration** after the configured past-due grace period when a balance remains.
- **Payment recovery** reminders for failed payments on open invoices.

All invoice generation and lifecycle changes flow through the existing transactional billing stores. Duplicate sweeps, retried jobs, and concurrent workers therefore resolve to the same invoice period or no-op transition instead of duplicating money movements.

### Retries and recovery

Jobs and notifications use bounded exponential backoff with a hard ceiling. Attempt counts and retry timestamps are persisted; a failed job returns to the durable queue after its backoff, and exhaustion moves it to `DEAD_LETTER`. Workers atomically claim rows with conditional updates, so two workers cannot process the same job. A sweep recovers rows stuck in `RUNNING` or `SENDING` after a worker crash and returns stale `QUEUED` rows to `PENDING`. Owners and admins can retry failed/dead-letter records from the Operations page; members have read-only access.

### Payment recovery safety

Recovery jobs send only dunning notifications. They never initiate a Razorpay charge because Subscript does not store a reusable customer authorization. When attempts are exhausted, `AUTOMATION_PAYMENT_EXHAUSTION_ACTION` selects `MARK_PAST_DUE` (default) or `CANCEL`; the summary records that no gateway charge was attempted. Gateway retries remain customer-initiated through Checkout.

### Notifications

Templates render organization, customer, plan, invoice, amount, period, and retry context. The default development adapter logs a short non-sensitive preview and never transmits email. SMTP can be enabled with `SMTP_HOST`, optional credentials, and `EMAIL_FROM`. Delivery status, provider message ID, attempt count, next attempt time, and a sanitized error are stored; message bodies and credentials are never returned by the operations API.

### Operations API and page

`/automation` shows queue and worker health, upcoming renewals, scheduled job history, failure details, notification history, and retry/dispatch controls. The API is organization-scoped. Reads are available to any member; retry and dispatch actions require `OWNER` or `ADMIN`. Responses omit raw job payloads, notification bodies, credentials, and provider secrets.

## Security model

- Passwords are hashed with bcrypt at cost 12 by default; login compares against a dummy hash for unknown emails to reduce timing differences.
- A session token is 32 random bytes. Only its SHA-256 hash is stored in the database; the browser receives the raw token in an HttpOnly cookie.
- Cookies use `SameSite=Lax`, `Path=/`, `HttpOnly`, and `Secure` in production. There is no token access from JavaScript or browser storage.
- Auth endpoints are rate limited (default 20 failed attempts per 15 minutes per client), with successful requests excluded.
- Unsafe HTTP methods reject disallowed `Origin` headers, adding CSRF protection beyond CORS while still allowing non-browser clients that omit the header.
- Every protected organization operation resolves the session from the database and revalidates that the user still belongs to the active organization.
- Organization renaming requires `OWNER` or `ADMIN`; members receive `403`.
- Customer, plan, subscription, invoice, and payment mutations require `OWNER` or `ADMIN`; members retain read access.
- Billing queries are scoped by the session's active organization, so cross-tenant IDs resolve as not found rather than leaking another workspace's records.
- Invoice generation and payment mutations run in database transactions and rely on unique constraints and row locks instead of trusting client-side totals or statuses.
- Gateway checkout amounts and currencies come from the invoice, never from the browser. Checkout signatures are verified server-side with timing-safe HMAC comparison, and the provider payment is re-fetched before a balance changes.
- Razorpay webhook signatures are verified over the raw request body. Provider event IDs are persisted with a unique `(provider, providerEventId)` constraint, and processing is transactional and idempotent.
- Gateway refunds reserve their amount before calling the provider; pending reservations count against the refundable balance to prevent over-refunds and duplicate concurrent requests.
- Razorpay key secrets and webhook secrets stay server-side; logs and API responses never include secrets, signatures, or full provider payloads. Gateway credentials are validated and live keys are rejected outside production.
- Gateway endpoints and webhooks have dedicated rate limits, and every gateway action is organization-scoped.
- Automation reads are organization-scoped; retry and dispatch controls require `OWNER` or `ADMIN`. Job payloads, notification bodies, SMTP credentials, and provider secrets are never returned by the API.
- Payment recovery never initiates a gateway charge. It only sends reminders and applies an explicit past-due or cancel rule after bounded attempts.
- Worker heartbeats and queue health checks are read-only and never expose Redis credentials or raw queue data.
- Cross-tenant switches return `403` and leave the session's active organization unchanged.
- Password hashes, session tokens, and other secrets are never included in API responses.

## Data model

The Prisma schema defines organization-scoped core entities:

- `User` (email, name, bcrypt password hash, last login)
- `Organization` (name, unique slug, default currency)
- `OrganizationMember` (composite key, role: owner/admin/member)
- `Session` (SHA-256 token hash, expiry, active organization)
- `Customer` (contact details, billing address, status, activity)
- `Plan` (monthly/annual intervals, price, currency, trial length, status)
- `Subscription` (status, quantity, price snapshot, interval, trial, billing periods, lifecycle timestamps, activity)
- `Invoice` (status, per-organization number, customer snapshot, integer minor-unit totals, tax basis points, billing period, line items, activity)
- `InvoiceCounter` (per-organization invoice sequence)
- `Payment` (manual or gateway source, method, status, provider order/payment/status/metadata, refunded total, lifecycle timestamps)
- `PaymentRefund` (pending/succeeded/failed provider refund ledger with provider refund ID and reason)
- `GatewayWebhookEvent` (provider event ID, type, status, payload, organization/payment link, error, timestamps)
- `AutomationJob` (durable scheduled work, idempotency key, queue, status, attempts, claim lock, retry time, sanitized error and result summary)
- `Notification` (deduplicated customer email intent, delivery status, attempts, next attempt, provider message ID, timestamps)

All money is stored as integer minor units and paired with an explicit currency code, so currencies without two decimal places (for example JPY) remain correct. API contracts use the same integer representation. Database check constraints keep quantities positive and monetary values non-negative, and unique indexes protect invoice numbering, billing-period idempotency, provider order/payment IDs, and webhook event IDs.

Committed migrations cover the auth core, the customer/plan catalogue, the subscription billing engine, the payment gateway, and background automation. Apply them with `npm run db:deploy` in production.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build shared contracts, then run web + API |
| `npm run dev:worker -w @subscript/server` | Run the BullMQ automation worker in watch mode |
| `npm run build` | Build shared, web, and server |
| `npm run lint` | ESLint across the monorepo |
| `npm run typecheck` | Generate Prisma client and typecheck all workspaces |
| `npm test` | Run server and web tests |
| `npm run db:generate` | Generate Prisma Client |
| `npm run db:validate` | Validate the Prisma schema |
| `npm run db:migrate` | Create/apply a development migration |
| `npm run db:deploy` | Apply committed migrations in production |
| `npm run db:studio` | Open Prisma Studio |
| `npm run start:worker -w @subscript/server` | Run the compiled worker (`dist/worker.js`) |

Shared types are built to `packages/shared/dist` before app dev/build. After changing a shared contract, restart `npm run dev` so both apps pick up the new build.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run db:validate
```

The billing suite includes PostgreSQL-only integration tests that exercise real row locks, unique constraints, and concurrent invoice/payment/gateway writes. They are skipped unless `TEST_DATABASE_URL` points at a disposable database:

```bash
TEST_DATABASE_URL=postgresql://user:password@localhost:55432/subscript_test \
  npm run test -w @subscript/server -- tests/billing-postgres.test.ts tests/gateway-postgres.test.ts tests/automation-postgres.test.ts
```

Gateway API tests use a mocked Razorpay server and signed synthetic webhooks; no real payment is created. Add `TEST_REDIS_URL` to exercise the optional BullMQ integration test; without it, that test skips without failing:

```bash
TEST_REDIS_URL=redis://localhost:6379 \
  npm run test -w @subscript/server -- tests/automation-redis.test.ts
```

Use throwaway PostgreSQL and Redis instances for these commands. Never point them at data you need to keep. Apply the committed migrations against PostgreSQL before a production deployment with `npm run db:deploy`.

## Phase boundaries

- Authentication, sessions, organization membership, roles, workspace settings, customers, plans, subscriptions, invoices, manual payments, Razorpay gateway payments, and background automation are implemented.
- The dashboard's revenue figures remain illustrative preview data; the customer, plan, billing, and operations pages use live API records.
- Automatic dunning sends reminders and applies an explicit past-due/cancel rule, but saved cards, automatic gateway charging, subscriptions billed directly by Razorpay, partial capture, and multi-currency conversion are not implemented.
- Gateway verification is exercised with mocked Razorpay responses and synthetic signed webhooks. Live end-to-end confirmation requires your own Test Mode or live credentials and a public webhook URL; no real payment is made by the automated suite.
- Automation tests that need Redis are optional and skipped unless `TEST_REDIS_URL` is set. PostgreSQL integration tests are skipped unless `TEST_DATABASE_URL` is set.
- Member invitations and role changes are not available yet; the settings page presents the roster the API holds.
- No secrets are committed; `.env` files are ignored.
