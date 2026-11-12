# Database

Subscript uses PostgreSQL as the durable source of truth. Prisma manages the
schema and migrations through `@prisma/adapter-pg` with a bounded connection
pool.

## Schema overview

Organization-scoped tables:

| Table | Purpose |
| --- | --- |
| `users` | Accounts, bcrypt password hash, last login |
| `organizations` | Workspace name, slug, default currency |
| `organization_members` | Membership and role (`OWNER`, `ADMIN`, `MEMBER`) |
| `sessions` | SHA-256 token hash, expiry, active organization |
| `customers` / `customer_activities` | Customer records and timeline |
| `plans` / `plan_activities` | Catalogue and timeline |
| `subscriptions` / `subscription_activities` | Billing lifecycle and timeline |
| `invoices` / `invoice_line_items` / `invoice_activities` | Invoice ledger and timeline |
| `invoice_counters` | Per-organization invoice number sequence |
| `payments` / `payment_refunds` | Manual and gateway payment ledger |
| `gateway_webhook_events` | Deduplicated provider events |
| `automation_jobs` | Durable scheduled work outbox |
| `notifications` | Deduplicated email delivery attempts |

Money is stored as integer minor units with an explicit currency. Check
constraints keep quantities positive and monetary values non-negative. Unique
constraints cover invoice numbers, invoice periods, provider order/payment IDs,
refund IDs, webhook event IDs, session hashes, and automation idempotency keys.

## Migrations

Committed migrations:

1. `20261104120000_init`
2. `20261104150000_customer_plan_management`
3. `20261104180000_subscription_billing_engine`
4. `20261106120000_payment_gateway`
5. `20261106153810_background_jobs`
6. `20261109113519_analytics_indexes`
7. `20261112150000_production_hardening_indexes`

The last migration adds indexes used by stale-worker and queue-recovery scans:

- `automation_jobs(status, lockedAt)`
- `automation_jobs(status, updatedAt)`
- `notifications(status, updatedAt)`

### Development

```bash
npm run db:migrate
```

Creates a new migration from the current schema and applies it to the configured
development database. Use `npm run db:generate` after schema changes.

### Production and staging

```bash
npm run db:deploy
```

Applies only committed migrations, never generates new ones. Run it as a release
step before starting the new API/worker version.

Rules:

- Back up the database before every production migration.
- Never run `prisma migrate reset`, `prisma db push`, or `db:migrate` against
  production data.
- Migration 7 uses plain `CREATE INDEX`, which takes a brief lock. For very
  large existing tables, schedule a maintenance window or create the indexes
  manually with `CREATE INDEX CONCURRENTLY` and mark the migration as applied
  only after verifying the resulting schema. Do not edit an already-applied
  migration.
- Apply migrations once per environment, not once per API replica. Use a
  dedicated release job or a single instance.

### Fresh deployment verification

```bash
createdb subscript_fresh
DATABASE_URL=postgresql://user:pass@host:5432/subscript_fresh npm run db:deploy
DATABASE_URL=postgresql://user:pass@host:5432/subscript_fresh npm run db:validate
```

All seven migrations should apply in order. Start the API and check
`/api/ready`; then run the PostgreSQL integration suite against that database
(see [testing.md](./testing.md)).

### Upgrade verification

For an existing database:

1. Take a backup.
2. Record the current migration status.
3. Apply `npm run db:deploy`.
4. Confirm only the new migration was applied.
5. Verify the new indexes exist:

```sql
SELECT indexname
FROM pg_indexes
WHERE tablename IN ('automation_jobs', 'notifications')
ORDER BY indexname;
```

6. Start the new application version and check `/api/ready` and a few core
   flows (login, list customers, open an invoice).

## Connection pool and timeouts

`createPrismaClient` configures:

- `DB_POOL_MAX` (default 10) connections per API or worker process
- `DB_IDLE_TIMEOUT_MS` (default 30s)
- `DB_CONNECTION_TIMEOUT_MS` (default 5s)
- `DB_STATEMENT_TIMEOUT_MS` (default 15s) through the session
  `statement_timeout`
- `timezone=UTC`
- An application name (`subscript-api` or `subscript-worker`) for monitoring

Size the pool across all processes:

```text
API replicas × DB_POOL_MAX
+ worker replicas × DB_POOL_MAX
+ migration/monitoring headroom
≤ database connection limit
```

Managed PostgreSQL often has a small connection limit on lower tiers. Reduce
`DB_POOL_MAX` rather than exhausting it. If you add PgBouncer, use transaction
pooling only if Prisma's prepared-statement behavior is compatible; test
thoroughly.

## Safe health checks

Use read-only checks:

```sql
SELECT 1;
```

`/api/ready` runs `SELECT 1` with a 3-second timeout. Do not use
`SELECT * FROM large_table`, locking queries, or write statements in health
checks. A readiness failure must not mutate data.

## Backup and restore

Use managed continuous backups/PITR where available. For self-managed
PostgreSQL:

```bash
# Logical backup (custom format, compressed, restorable selectively)
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > subscript.dump

# Globals (roles, grants) separately
pg_dumpall --globals-only "$DATABASE_URL" > subscript-globals.sql
```

Restore into a new database, verify, then cut over:

```bash
createdb subscript_restore
pg_restore --no-owner --no-acl --dbname=postgresql://user:pass@host:5432/subscript_restore subscript.dump
psql "postgresql://user:pass@host:5432/subscript_restore" -c "SELECT 1"
```

See [backup-recovery.md](./backup-recovery.md) for the full runbook, retention,
and restore drills.

## Data safety

- Tenant isolation is enforced in queries, not only in the UI.
- Cross-tenant IDs resolve as not found.
- Billing mutations run in transactions with row locks and unique constraints.
- Deleting a plan is only allowed when it has no subscriptions.
- Issued invoices, payments, refunds, and activity records are retained for
  audit rather than deleted.
- Redis is transport, not the source of truth. Losing Redis never loses a
  durable job or notification; the next sweep re-dispatches pending rows.

## Useful queries

```sql
-- Migration status
SELECT migration_name, finished_at
FROM _prisma_migrations
ORDER BY started_at;

-- Stale automation rows
SELECT status, count(*)
FROM automation_jobs
GROUP BY status
ORDER BY status;

-- Notification backlog
SELECT status, count(*)
FROM notifications
GROUP BY status;

-- Table and index sizes
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
```

Use read-only credentials for ad-hoc diagnostics where possible. Never paste
production connection strings or query results containing personal data into
logs, tickets, or chat.
