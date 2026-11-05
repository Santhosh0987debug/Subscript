# Subscript

Subscript is a multi-tenant subscription and revenue management platform. Phase 4 adds the subscription and billing engine: tenant-scoped subscriptions, a centralized lifecycle state machine, invoice generation with tax and line items, and manual payment records.

Authentication, sessions, organization membership, customers, plans, subscriptions, invoices, and payments are live and enforced by the API. The revenue dashboard still uses illustrative data.

## Manual billing scope

Phase 4 is a manual billing engine. It records what your team has billed and collected; it does not connect to a payment gateway, charge a card, or confirm funds with an external processor. Every payment is an internal `MANUAL` entry, and the UI labels it that way. Gateway payment sources are reserved in the schema but are not produced by any endpoint.

## Stack

- **Web:** React 19, TypeScript, Vite, Tailwind CSS 4, React Router
- **Server:** Node.js, Express 5, TypeScript, Zod, Helmet, CORS
- **Auth:** bcrypt password hashing, opaque cookie sessions, SHA-256 token hashes
- **Data:** PostgreSQL, Prisma 7 (`prisma-client` + `@prisma/adapter-pg`)
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
- Transactional balance updates and idempotent invoice generation; duplicate invoices per subscription period and overpayments are rejected
- Printable invoice view with print CSS for browser print or save-as-PDF
- Auth rate limiting, strict request validation, an Origin guard for unsafe methods, and a consistent API error envelope
- Web tests for form validation, identity helpers, and billing helpers; API tests for billing math, lifecycle transitions, invoices, payments, concurrency, tenancy, roles, auth, and rate limiting

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
- PostgreSQL 15+ only when exercising the Prisma-backed runtime

Frontend development, linting, tests, typechecks, and builds do not require a running database. Local development without `DATABASE_URL` uses in-memory stores for auth, customers, plans, subscriptions, invoices, and payments.

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

### Local PostgreSQL (optional)

If Docker is available:

```bash
docker compose up -d
```

Uncomment `DATABASE_URL` in `apps/server/.env`, then apply the committed migration:

```bash
npm run db:migrate
```

The Compose defaults use user `subscript`, password `subscript_dev`, and database `subscript`. Adjust the connection string for an existing PostgreSQL instance.

### Development without PostgreSQL

Leave `DATABASE_URL` commented out. The API uses in-memory stores so registration, login, workspace switching, sessions, catalogues, subscriptions, invoices, and payments can be exercised locally. The stores reset whenever the API restarts and are never used in production. Production requires `DATABASE_URL` and always uses Prisma.

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
| `POST` | `/api/subscriptions/:subscriptionId/invoices` | Generate (or return) the invoice for the current period |
| `GET` | `/api/invoices` | List invoices with search, status, customer/subscription filters, sort, and paging |
| `GET` | `/api/invoices/:invoiceId` | Invoice detail with line items, payments, and timeline |
| `POST` | `/api/invoices/:invoiceId/issue` | Move a draft invoice to open |
| `POST` | `/api/invoices/:invoiceId/void` | Void an unpaid invoice without deleting it |
| `POST` | `/api/invoices/:invoiceId/mark-uncollectible` | Write off an unpaid invoice |
| `POST` | `/api/invoices/:invoiceId/payments` | Record a manual pending or succeeded payment |
| `POST` | `/api/payments/:paymentId/succeed` | Confirm a pending payment |
| `POST` | `/api/payments/:paymentId/fail` | Mark a pending payment failed |
| `POST` | `/api/payments/:paymentId/refund` | Refund a succeeded payment |

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

### Manual payments

Payments are manual internal records. Supported methods are cash, bank transfer, card, check, and other. A payment may be recorded as `PENDING` or `SUCCEEDED`; pending attempts can later be confirmed, failed, or left in history. Succeeded payments can be refunded. Partial payments and multiple attempts are supported, while overpayment is rejected. Failed and refunded attempts never reduce the balance.

No payment gateway is contacted. `GATEWAY` is reserved in the data model but no endpoint creates such a payment, and the UI explicitly labels every payment as a manual entry.

### Auditing and tenant safety

Every subscription and invoice mutation appends an activity record with the acting user. All queries are organization-scoped; client-supplied organization IDs, totals, currencies, and statuses are never trusted. Billing writes for administrators are restricted to `OWNER` and `ADMIN`, while members can read records in their workspace.

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
- `Payment` (manual or reserved gateway source, method, status, transaction reference, lifecycle timestamps)

All money is stored as integer minor units and paired with an explicit currency code, so currencies without two decimal places (for example JPY) remain correct. API contracts use the same integer representation. Database check constraints keep quantities positive and monetary values non-negative, and unique indexes protect invoice numbering and billing-period idempotency.

Committed migrations cover the auth core, the customer/plan catalogue, and the subscription billing engine. Apply them with `npm run db:deploy` in production.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build shared contracts, then run web + API |
| `npm run build` | Build shared, web, and server |
| `npm run lint` | ESLint across the monorepo |
| `npm run typecheck` | Generate Prisma client and typecheck all workspaces |
| `npm test` | Run server and web tests |
| `npm run db:generate` | Generate Prisma Client |
| `npm run db:validate` | Validate the Prisma schema |
| `npm run db:migrate` | Create/apply a development migration |
| `npm run db:deploy` | Apply committed migrations in production |
| `npm run db:studio` | Open Prisma Studio |

Shared types are built to `packages/shared/dist` before app dev/build. After changing a shared contract, restart `npm run dev` so both apps pick up the new build.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run db:validate
```

The billing suite includes PostgreSQL-only integration tests that exercise real row locks, unique constraints, and concurrent invoice/payment writes. They are skipped unless `TEST_DATABASE_URL` points at a disposable database:

```bash
TEST_DATABASE_URL=postgresql://user:password@localhost:55432/subscript_test \
  npm run test -w @subscript/server -- tests/billing-postgres.test.ts
```

Use a throwaway database for this command. Never point it at a database whose data you need to keep; the test applies migrations and truncates billing tables. Also apply the committed migration against PostgreSQL before a production deployment with `npm run db:deploy`.

## Phase boundaries

- Authentication, sessions, organization membership, roles, workspace settings, customers, plans, subscriptions, invoices, and manual payments are implemented.
- The dashboard's revenue figures remain illustrative preview data; the customer, plan, and billing pages use live API records.
- Billing is intentionally manual. There is no gateway integration, card charging, checkout, webhook reconciliation, or automatic dunning worker. Lifecycle changes and invoice generation are explicit actions.
- Member invitations and role changes are not available yet; the settings page presents the roster the API holds.
- No secrets are committed; `.env` files are ignored.
