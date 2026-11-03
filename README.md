# Subscript

Subscript is a multi-tenant subscription and revenue management platform. Phase 1 establishes the monorepo, the visual language, the API foundation, and the PostgreSQL/Prisma data model.

The dashboard is fully previewable with illustrative data. No authentication, payments, billing provider, or live customer data is implemented in this phase.

## Stack

- **Web:** React 19, TypeScript, Vite, Tailwind CSS 4, React Router
- **Server:** Node.js, Express 5, TypeScript, Zod, Helmet, CORS
- **Data:** PostgreSQL, Prisma 7 (`prisma-client` + `@prisma/adapter-pg`)
- **Shared:** `@subscript/shared` domain types and HTTP contracts
- **Tooling:** npm workspaces, ESLint, Vitest, strict TypeScript

## Structure

```text
subscript/
├── apps/
│   ├── web/                    React dashboard
│   │   ├── public/
│   │   └── src/
│   │       ├── app/            Router and error boundary
│   │       ├── components/
│   │       │   ├── dashboard/  Metrics, chart, activity, renewals
│   │       │   ├── layout/     Sidebar, topbar, app shell
│   │       │   └── ui/         Buttons, cards, badges, states
│   │       ├── data/           Illustrative Phase 1 data
│   │       ├── hooks/
│   │       ├── lib/            Formatting, chart math, CSV, API client
│   │       ├── pages/
│   │       └── styles/
│   └── server/                 Express API
│       ├── prisma/
│       │   └── schema.prisma
│       ├── src/
│       │   ├── config/         Environment validation
│       │   ├── db/             Prisma client factory
│       │   ├── errors/
│       │   ├── lib/
│       │   ├── middleware/     Request ID, 404, error handling
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
- PostgreSQL 15+ only when exercising database commands

Frontend development, linting, tests, typechecks, and builds do not require a running database.

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

Then create the first migration:

```bash
npm run db:migrate -- --name init
```

The default connection string in `apps/server/.env.example` points at the Compose database. Adjust it for an existing PostgreSQL instance.

## Run

```bash
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000
- Health: http://localhost:4000/api/health

The sidebar shows a live API status indicator. If the API is not running, the UI remains fully previewable and the indicator reports it honestly.

### Production-style preview

```bash
npm run build
npm run preview -w @subscript/web
```

The API can be started in a second terminal for the health indicator:

```bash
npm run start -w @subscript/server
```

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

## Environment

### Server (`apps/server/.env`)

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | `development`, `test`, or `production` |
| `PORT` | No | `4000` | Validated 1-65535 |
| `DATABASE_URL` | Production | — | Must use `postgresql://` or `postgres://` |
| `CORS_ORIGINS` | Production | `http://localhost:5173,http://localhost:4173` | Comma-separated origins; wildcards rejected |

Environment validation fails fast at API startup. The health endpoint is independent of database connectivity, and the API can run in development without `DATABASE_URL` while database features are disabled.

### Web (`apps/web/.env`)

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `VITE_API_URL` | No | `http://localhost:4000` | Used for the API health indicator |

## API

`GET /api/health`

```json
{
  "status": "ok",
  "service": "subscript-api",
  "version": "0.1.0",
  "timestamp": "2026-11-03T12:00:00.000Z",
  "uptimeSeconds": 42
}
```

Errors use one envelope:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "No route matches GET /api/missing.",
    "requestId": "6e5f98e6-..."
  }
}
```

Every response carries an `X-Request-Id`, and internal error details are logged but never returned.

## Data model

The Prisma schema defines tenant-scoped core entities:

- `Tenant`, `User`, `Membership` (roles: owner, admin, member, viewer)
- `Customer`
- `Plan` (monthly/annual intervals, decimal money, currency)
- `Subscription` (lifecycle states, periods, quantities)
- `Invoice` (statuses, totals, payment dates)

Money is stored as PostgreSQL `Decimal(12, 2)` at the database boundary and represented as integer minor units in shared API contracts.

## Phase 1 boundaries

- Mock data only; no provider imports or writes.
- No authentication or authorization.
- No billing, checkout, payment, or webhook flows.
- Placeholder pages intentionally present empty states and planned scope.
- No secrets are committed; `.env` files are ignored.

Phase 2 is intentionally not started.
