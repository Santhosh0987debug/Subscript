# Backup and recovery

PostgreSQL is the system of record. Redis, the web build, and application images
are reproducible. A recovery plan therefore centers on PostgreSQL backups,
secret availability, and a tested deployment path.

## Objectives

Set explicit targets with the product owner:

| Objective | Suggested starting point |
| --- | --- |
| Recovery point objective (RPO) | ≤ 5 minutes with managed PITR; ≤ 24 hours with nightly logical backups |
| Recovery time objective (RTO) | ≤ 1 hour for a managed restore; ≤ 4 hours for a self-managed restore |
| Restore drill cadence | Quarterly, or after any schema/infrastructure change |

Managed PostgreSQL should use continuous backups with point-in-time recovery.
Logical dumps are the fallback and the portable copy.

## What to back up

- PostgreSQL database (required)
- Database roles/grants for self-managed instances
- Environment secrets in the platform secret store (not in the backup archive)
- Deployment configuration: `render.yaml`, `vercel.json`, Dockerfiles, CI
- Redis is optional; durable jobs live in PostgreSQL. Back it up only to reduce
  re-dispatch work.

Do not store database dumps or `.env` files in the repository.

## Managed PostgreSQL

Enable automated backups and PITR in the provider console. Confirm:

- The retention window meets the RPO.
- Backups are encrypted at rest and in transit.
- Restores can target a new instance without overwriting production.
- The provider's maintenance window is known.

Record the provider, plan, region, retention, and restore procedure in the
team's runbook.

## Logical backups

For self-managed PostgreSQL or an extra portable copy:

```bash
# Custom format: compressed, selective restore, parallel restore
pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --file=subscript-$(date +%Y%m%d-%H%M).dump \
  "$DATABASE_URL"

# Roles and grants
pg_dumpall --globals-only "$DATABASE_URL" > subscript-globals.sql

# Verify the archive is readable
pg_restore --list subscript-YYYYMMDD-HHMM.dump > /dev/null
```

Store backups in encrypted object storage with lifecycle retention and access
logging. Restrict restore permissions to the operations team.

Suggested retention:

- 7 daily
- 4 weekly
- 12 monthly
- Keep at least one copy outside the primary region/provider

## Restore procedure

Never restore directly over production. Restore to a new database, verify, then
cut over.

### 1. Provision a target

Create a new database/instance with the same major PostgreSQL version and
extensions.

### 2. Restore

```bash
createdb subscript_restore

pg_restore \
  --no-owner \
  --no-acl \
  --dbname="postgresql://user:pass@host:5432/subscript_restore" \
  subscript-YYYYMMDD-HHMM.dump
```

If roles are missing, apply the globals file first (review it before running):

```bash
psql "postgresql://admin@host:5432/postgres" -f subscript-globals.sql
```

### 3. Verify data

```sql
SELECT count(*) FROM users;
SELECT count(*) FROM organizations;
SELECT count(*) FROM invoices;
SELECT migration_name, finished_at
FROM _prisma_migrations
ORDER BY started_at;
```

Compare row counts and the latest timestamps with monitoring data from before
the incident. Check that all expected migrations are applied. Do not run
`prisma migrate reset`.

### 4. Point the application at the restored database

- Update `DATABASE_URL` in the platform secret store.
- Restart the API and worker.
- Check `/api/ready`.
- Sign in and verify a customer, invoice, and analytics response.

### 5. Cut over and preserve evidence

Keep the old database read-only until the incident review is complete. Do not
delete backups or logs that may be needed for forensics.

## PITR recovery

1. Identify the target timestamp just before the data loss or bad migration.
2. Use the provider's restore-to-point-in-time feature to create a new instance.
3. Verify the migration table and recent audit/activity rows.
4. Follow steps 4–5 above.

Document the exact timestamp and reason in the incident record.

## Recovery drills

At least quarterly:

1. Restore the latest backup into a disposable database.
2. Apply `npm run db:deploy` only if the backup predates the current release;
   otherwise confirm it is already at the expected migration.
3. Start an API against the restored database and run smoke checks.
4. Record the restore duration and any missing steps.
5. Delete the disposable database after verification.

A backup is not proven until it has been restored.

## Redis recovery

- Durable jobs and notifications are in PostgreSQL; Redis loss is not data loss.
- Restore Redis or start a fresh instance, update `REDIS_URL`, and restart the
  worker.
- The worker runs an immediate sweep and re-dispatches pending rows.
- BullMQ job IDs and idempotency keys make re-dispatch safe.
- If some notifications were already sent but not marked complete, review the
  notification history before bulk retrying to avoid duplicate email.

## Secret recovery and rotation

If secrets may have been exposed:

1. Rotate `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` in Razorpay and
   the API/worker environment.
2. Rotate `METRICS_TOKEN` and update the scraper.
3. Rotate SMTP credentials.
4. Rotate the database password and update the connection string.
5. Rotate Redis credentials/TLS material.
6. Revoke active sessions if account compromise is suspected:

```sql
DELETE FROM sessions;
```

All users must sign in again. Review logs for unauthorized access. Remember that
session tokens are stored only as hashes; deleting sessions is a safe
invalidation mechanism.

## Migration-related incidents

- **Failed migration**: read the provider error, take a backup, and fix forward
  with a new migration. Do not edit an applied migration.
- **Migration applied to the wrong database**: stop the deployment, restore the
  correct database from backup, and verify `/api/ready`.
- **Long lock**: cancel the migration query if safe, then schedule the index
  creation with `CREATE INDEX CONCURRENTLY` during low traffic. Mark the
  migration as applied only after verifying the schema.
- **Data corruption**: stop writes, restore to a new instance, and follow the
  cutover procedure.

## Incident checklist

- [ ] Declare an incident and assign an owner
- [ ] Stop writes or disable the affected feature if data is at risk
- [ ] Record timestamps, versions, and recent changes
- [ ] Take a forensic backup before modifying the primary
- [ ] Restore/repair into a new instance
- [ ] Verify row counts, migrations, and core flows
- [ ] Cut over `DATABASE_URL` and restart API/worker
- [ ] Check readiness, error rates, queue health, and payment reconciliation
- [ ] Notify affected customers if required
- [ ] Rotate exposed secrets
- [ ] Write a post-incident review with prevention actions
