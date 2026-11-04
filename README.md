# Subscript

Subscript is a multi-tenant subscription and revenue management platform. Phase 2 adds secure authentication, cookie-based sessions, organization-based tenancy, protected routes, workspace switching, and a team settings page.

The revenue dashboard still uses illustrative data, but authentication, sessions, and organization membership are live and enforced by the API.

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
- Auth rate limiting, strict request validation, an Origin guard for unsafe methods, and a consistent API error envelope
- Web tests for form validation and identity helpers; API tests for registration, login, logout, expiry, roles, tenant isolation, CORS, and rate limiting

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
│   │       ├── lib/            API client, formatting, chart math, errors
│   │       ├── pages/
│   │       └── styles/
│   └── server/                 Express API
│       ├── prisma/
│       │   ├── migrations/     Initial PostgreSQL migration
│       │   └── schema.prisma
│       ├── src/
│       │   ├── auth/           Service, stores, password/session helpers
│       │   ├── config/         Environment validation
│       │   ├── db/             Prisma client factory
│       │   ├── errors/
│       │   ├── lib/
│       │   ├── middleware/     Auth, tenancy, roles, rate limits, errors
│       │   ├── routes/
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

Frontend development, linting, tests, typechecks, and builds do not require a running database. Local development without `DATABASE_URL` uses an in-memory auth store.

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

Leave `DATABASE_URL` commented out. The API uses an in-memory auth store so registration, login, workspace switching, and sessions can be exercised locally. The store resets whenever the API restarts and is never used in production. Production requires `DATABASE_URL` and always uses Prisma.

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

## Security model

- Passwords are hashed with bcrypt at cost 12 by default; login compares against a dummy hash for unknown emails to reduce timing differences.
- A session token is 32 random bytes. Only its SHA-256 hash is stored in the database; the browser receives the raw token in an HttpOnly cookie.
- Cookies use `SameSite=Lax`, `Path=/`, `HttpOnly`, and `Secure` in production. There is no token access from JavaScript or browser storage.
- Auth endpoints are rate limited (default 20 failed attempts per 15 minutes per client), with successful requests excluded.
- Unsafe HTTP methods reject disallowed `Origin` headers, adding CSRF protection beyond CORS while still allowing non-browser clients that omit the header.
- Every protected organization operation resolves the session from the database and revalidates that the user still belongs to the active organization.
- Organization renaming requires `OWNER` or `ADMIN`; members receive `403`.
- Cross-tenant switches return `403` and leave the session's active organization unchanged.
- Password hashes, session tokens, and other secrets are never included in API responses.

## Data model

The Prisma schema defines organization-scoped core entities:

- `User` (email, name, bcrypt password hash, last login)
- `Organization` (name, unique slug, default currency)
- `OrganizationMember` (composite key, role: owner/admin/member)
- `Session` (SHA-256 token hash, expiry, active organization)
- `Customer`
- `Plan` (monthly/annual intervals, decimal money, currency)
- `Subscription` (lifecycle states, periods, quantities)
- `Invoice` (statuses, totals, payment dates)

Money is stored as PostgreSQL `Decimal(12, 2)` at the database boundary and represented as integer minor units in shared API contracts. Future business entities carry an `organizationId` foreign key so tenant scoping is structural, not optional.

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

Also apply the committed migration against PostgreSQL before a production deployment with `npm run db:deploy`.

## Phase boundaries

- Authentication, sessions, organization membership, roles, and workspace settings are implemented.
- The dashboard's revenue figures remain illustrative preview data; customer, plan, subscription, and invoice management are intentionally not implemented yet.
- Member invitations and role changes are not available in Phase 2; the settings page accurately presents the roster the API holds.
- No billing provider, checkout, payment, or webhook flow is implemented.
- No secrets are committed; `.env` files are ignored.
