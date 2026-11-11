import type {
  AnalyticsChurnPoint,
  AnalyticsCustomerRow,
  AnalyticsCustomersResponse,
  AnalyticsInvoiceAgingRow,
  AnalyticsInvoiceCurrency,
  AnalyticsInvoicePointCurrency,
  AnalyticsInvoicesResponse,
  AnalyticsMrrPoint,
  AnalyticsMrrPointCurrency,
  AnalyticsMrrResponse,
  AnalyticsOverviewCurrency,
  AnalyticsOverviewResponse,
  AnalyticsPlanRow,
  AnalyticsRevenuePoint,
  AnalyticsRevenuePointCurrency,
  AnalyticsRevenueResponse,
  AnalyticsSubscriptionGrowthPoint,
  AnalyticsSubscriptionGrowthResponse,
  AnalyticsAgingBucket,
} from "@subscript/shared";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import {
  percentageBps,
  sortCurrencyAmounts,
} from "../calc.js";
import type { ResolvedAnalyticsQuery } from "../range.js";
import { toAnalyticsRange } from "../range.js";
import type {
  AnalyticsRevenueReportRow,
  AnalyticsStore,
  AnalyticsSubscriptionReportRow,
} from "../types.js";

type DbRow = Record<string, unknown>;

interface CurrencyTotals {
  gross: Map<string, number>;
  refunded: Map<string, number>;
}

function toNumber(value: unknown): number {
  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toDateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function readNumber(row: DbRow, key: string): number {
  return toNumber(row[key]);
}

function readString(row: DbRow, key: string, fallback = ""): string {
  return toStringValue(row[key], fallback);
}

function readDate(row: DbRow, key: string): Date | null {
  return toDateValue(row[key]);
}

function moneyMap(rows: readonly DbRow[], key: string): Map<string, number> {
  const map = new Map<string, number>();

  for (const row of rows) {
    map.set(readString(row, "currency"), readNumber(row, key));
  }

  return map;
}

function currencyRowMap(
  currency: string,
): AnalyticsRevenuePointCurrency {
  return {
    currency,
    invoicedMinor: 0,
    grossCollectedMinor: 0,
    refundedMinor: 0,
    netCollectedMinor: 0,
    outstandingMinor: 0,
    newSubscriptions: 0,
    canceledSubscriptions: 0,
  };
}

function buildBucketsJson(query: ResolvedAnalyticsQuery): string {
  return JSON.stringify(
    query.buckets.map((bucket) => ({
      bucket_start: bucket.start.toISOString(),
      bucket_end: bucket.end.toISOString(),
      label: bucket.label,
    })),
  );
}

function bucketIndex(
  query: ResolvedAnalyticsQuery,
  start: Date | null,
): number {
  if (!start) {
    return -1;
  }

  return query.buckets.findIndex(
    (bucket) => bucket.start.getTime() === start.getTime(),
  );
}

/** Reads a value that must exist because the index came from a matching bucket. */
function at<T>(values: readonly T[], index: number): T {
  const value = values[index];

  if (value === undefined) {
    throw new Error(`Analytics bucket index ${index} is out of range.`);
  }

  return value;
}

function revenueSubsCte(organizationId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT
      s.id,
      s."customerId" AS customer_id,
      s."planId" AS plan_id,
      s."planName" AS plan_name,
      s."planCode" AS plan_code,
      s.status,
      s.quantity,
      s."unitAmountMinor" AS unit_amount_minor,
      s.currency,
      s.interval,
      s."startedAt" AS started_at,
      s."trialEndsAt" AS trial_ends_at,
      s."endedAt" AS ended_at,
      s."canceledAt" AS canceled_at,
      s."pausedAt" AS paused_at,
      GREATEST(s."startedAt", COALESCE(s."trialEndsAt", s."startedAt")) AS revenue_start,
      CASE
        WHEN s.status = 'PAUSED' THEN s."pausedAt"
        ELSE COALESCE(s."endedAt", s."canceledAt")
      END AS revenue_end,
      COALESCE(s."endedAt", s."canceledAt") AS access_end,
      ROUND(
        s."unitAmountMinor" * s.quantity *
        CASE WHEN s.interval = 'YEAR' THEN 1.0 / 12 ELSE 1 END
      )::bigint AS mrr_minor
    FROM subscriptions s
    WHERE s."organizationId" = ${organizationId}
  `;
}

function cashEventsCte(
  organizationId: string,
  from: Date,
  toExclusive: Date,
): Prisma.Sql {
  return Prisma.sql`
    SELECT
      p.currency,
      p."invoiceId" AS invoice_id,
      p."paidAt" AS occurred_at,
      p."amountMinor"::bigint AS gross_minor,
      0::bigint AS refund_minor
    FROM payments p
    WHERE p."organizationId" = ${organizationId}
      AND p.status IN ('SUCCEEDED', 'REFUNDED')
      AND p."paidAt" IS NOT NULL
      AND p."paidAt" >= ${from}
      AND p."paidAt" < ${toExclusive}
    UNION ALL
    SELECT
      r.currency,
      r."invoiceId" AS invoice_id,
      r."processedAt" AS occurred_at,
      0::bigint AS gross_minor,
      r."amountMinor"::bigint AS refund_minor
    FROM payment_refunds r
    WHERE r."organizationId" = ${organizationId}
      AND r.status = 'SUCCEEDED'
      AND r."processedAt" IS NOT NULL
      AND r."processedAt" >= ${from}
      AND r."processedAt" < ${toExclusive}
    UNION ALL
    SELECT
      p.currency,
      p."invoiceId" AS invoice_id,
      p."refundedAt" AS occurred_at,
      0::bigint AS gross_minor,
      p."refundedAmountMinor"::bigint AS refund_minor
    FROM payments p
    WHERE p."organizationId" = ${organizationId}
      AND p.status = 'REFUNDED'
      AND p."refundedAt" IS NOT NULL
      AND p."refundedAt" >= ${from}
      AND p."refundedAt" < ${toExclusive}
      AND NOT EXISTS (
        SELECT 1
        FROM payment_refunds rp
        WHERE rp."paymentId" = p.id AND rp.status = 'SUCCEEDED'
      )
  `;
}

async function cashTotals(
  prisma: PrismaClient,
  organizationId: string,
  from: Date,
  toExclusive: Date,
): Promise<CurrencyTotals> {
  const rows = await prisma.$queryRaw<DbRow[]>(Prisma.sql`
    WITH events AS (${cashEventsCte(organizationId, from, toExclusive)})
    SELECT
      currency,
      COALESCE(SUM(gross_minor), 0)::bigint AS gross,
      COALESCE(SUM(refund_minor), 0)::bigint AS refunded
    FROM events
    GROUP BY currency
  `);

  return {
    gross: new Map(rows.map((row) => [readString(row, "currency"), readNumber(row, "gross")])),
    refunded: new Map(
      rows.map((row) => [readString(row, "currency"), readNumber(row, "refunded")]),
    ),
  };
}

async function outstandingTotals(
  prisma: PrismaClient,
  organizationId: string,
): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<DbRow[]>(Prisma.sql`
    SELECT currency, COALESCE(SUM("totalMinor" - "amountPaidMinor"), 0)::bigint AS amount
    FROM invoices
    WHERE "organizationId" = ${organizationId}
      AND status = 'OPEN'
      AND "totalMinor" > "amountPaidMinor"
    GROUP BY currency
  `);

  return moneyMap(rows, "amount");
}

function mergeCurrencySets(
  ...maps: ReadonlyMap<string, unknown>[]
): string[] {
  const currencies = new Set<string>();

  for (const map of maps) {
    for (const currency of map.keys()) {
      currencies.add(currency);
    }
  }

  return [...currencies];
}

function sortedCurrencies(
  currencies: readonly string[],
  defaultCurrency: string,
): string[] {
  return [...currencies].sort((left, right) => {
    if (left === right) {
      return 0;
    }

    if (left === defaultCurrency) {
      return -1;
    }

    if (right === defaultCurrency) {
      return 1;
    }

    return left.localeCompare(right);
  });
}

export function createPrismaAnalyticsStore(
  prisma: PrismaClient,
): AnalyticsStore {
  async function getDefaultCurrency(organizationId: string): Promise<string> {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { defaultCurrency: true },
    });

    return organization?.defaultCurrency ?? "USD";
  }

  async function getOverview(
    organizationId: string,
    query: ResolvedAnalyticsQuery,
  ): Promise<AnalyticsOverviewResponse> {
    const defaultCurrency = await getDefaultCurrency(organizationId);
    const epoch = new Date("1970-01-01T00:00:00.000Z");
    const snapshotAt = query.toExclusive;

    const [
      snapshotRows,
      statusRows,
      eventRows,
      customerRows,
      retentionRows,
      rangeCash,
      lifetimeCash,
      payerRows,
      outstanding,
    ] = await Promise.all([
      prisma.$queryRaw<DbRow[]>(Prisma.sql`
        WITH revenue_subs AS (${revenueSubsCte(organizationId)})
        SELECT
          currency,
          COUNT(*)::int AS active_subscriptions,
          COUNT(DISTINCT customer_id)::int AS active_customers,
          COALESCE(SUM(mrr_minor), 0)::bigint AS mrr_minor
        FROM revenue_subs
        WHERE revenue_start <= ${snapshotAt}
          AND (revenue_end IS NULL OR revenue_end > ${snapshotAt})
        GROUP BY currency
      `),
      prisma.$queryRaw<DbRow[]>(Prisma.sql`
        SELECT status::text AS status, COUNT(*)::int AS count
        FROM subscriptions
        WHERE "organizationId" = ${organizationId}
        GROUP BY status
      `),
      prisma.$queryRaw<DbRow[]>(Prisma.sql`
        WITH revenue_subs AS (${revenueSubsCte(organizationId)})
        SELECT
          COUNT(*) FILTER (
            WHERE started_at >= ${query.from} AND started_at < ${query.toExclusive}
          )::int AS new_subscriptions,
          COUNT(*) FILTER (
            WHERE status IN ('CANCELED', 'EXPIRED')
              AND access_end >= ${query.from} AND access_end < ${query.toExclusive}
          )::int AS canceled_subscriptions,
          COUNT(*) FILTER (
            WHERE status IN ('CANCELED', 'EXPIRED')
              AND access_end >= ${query.from} AND access_end < ${query.toExclusive}
              AND started_at <= ${query.from}
          )::int AS churned_from_start,
          COUNT(*) FILTER (
            WHERE started_at <= ${query.from}
              AND (access_end IS NULL OR access_end > ${query.from})
          )::int AS starting_subscriptions,
          COUNT(*) FILTER (
            WHERE started_at <= ${query.toExclusive}
              AND (access_end IS NULL OR access_end > ${query.toExclusive})
          )::int AS ending_subscriptions
        FROM revenue_subs
      `),
      prisma.$queryRaw<DbRow[]>(Prisma.sql`
        WITH revenue_subs AS (${revenueSubsCte(organizationId)}),
        first_starts AS (
          SELECT customer_id, MIN(started_at) AS first_start
          FROM revenue_subs
          GROUP BY customer_id
        ),
        starting AS (
          SELECT DISTINCT customer_id
          FROM revenue_subs
          WHERE started_at <= ${query.from}
            AND (access_end IS NULL OR access_end > ${query.from})
        ),
        ending AS (
          SELECT DISTINCT customer_id
          FROM revenue_subs
          WHERE started_at <= ${query.toExclusive}
            AND (access_end IS NULL OR access_end > ${query.toExclusive})
        )
        SELECT
          (SELECT COUNT(*)::int FROM customers WHERE "organizationId" = ${organizationId}) AS total_customers,
          (SELECT COUNT(*)::int FROM ending) AS active_customers,
          (
            SELECT COUNT(*)::int FROM first_starts
            WHERE first_start >= ${query.from} AND first_start < ${query.toExclusive}
          ) AS new_customers,
          (
            SELECT COUNT(*)::int
            FROM first_starts f
            WHERE f.first_start < ${query.from}
              AND EXISTS (
                SELECT 1 FROM revenue_subs s
                WHERE s.customer_id = f.customer_id
                  AND s.started_at >= ${query.from}
                  AND s.started_at < ${query.toExclusive}
              )
          ) AS returning_customers,
          (
            SELECT COUNT(*)::int
            FROM starting st
            WHERE NOT EXISTS (
              SELECT 1 FROM ending e WHERE e.customer_id = st.customer_id
            )
          ) AS churned_customers,
          (SELECT COUNT(*)::int FROM starting) AS starting_customers
      `),
      prisma.$queryRaw<DbRow[]>(Prisma.sql`
        WITH revenue_subs AS (${revenueSubsCte(organizationId)})
        SELECT
          currency,
          COALESCE(SUM(mrr_minor) FILTER (
            WHERE revenue_start <= ${query.from}
              AND (revenue_end IS NULL OR revenue_end > ${query.from})
          ), 0)::bigint AS starting_mrr,
          COALESCE(SUM(mrr_minor) FILTER (
            WHERE status IN ('CANCELED', 'EXPIRED')
              AND access_end >= ${query.from} AND access_end < ${query.toExclusive}
              AND started_at <= ${query.from}
          ), 0)::bigint AS churned_mrr,
          COALESCE(SUM(mrr_minor) FILTER (
            WHERE revenue_start >= ${query.from}
              AND revenue_start < ${query.toExclusive}
              AND EXISTS (
                SELECT 1 FROM revenue_subs prior
                WHERE prior.customer_id = revenue_subs.customer_id
                  AND prior.id <> revenue_subs.id
                  AND prior.revenue_start <= ${query.from}
                  AND (prior.revenue_end IS NULL OR prior.revenue_end > ${query.from})
              )
          ), 0)::bigint AS expansion_mrr
        FROM revenue_subs
        GROUP BY currency
      `),
      cashTotals(prisma, organizationId, query.from, query.toExclusive),
      cashTotals(prisma, organizationId, epoch, query.toExclusive),
      prisma.$queryRaw<DbRow[]>(Prisma.sql`
        SELECT p.currency, COUNT(DISTINCT i."customerId")::int AS payers
        FROM payments p
        JOIN invoices i ON i.id = p."invoiceId"
        WHERE p."organizationId" = ${organizationId}
          AND p.status IN ('SUCCEEDED', 'REFUNDED')
          AND p."paidAt" IS NOT NULL
          AND p."paidAt" < ${query.toExclusive}
        GROUP BY p.currency
      `),
      outstandingTotals(prisma, organizationId),
    ]);

    const snapshot = new Map(
      snapshotRows.map((row) => [readString(row, "currency"), row]),
    );
    const statusCounts = new Map(
      statusRows.map((row) => [
        readString(row, "status"),
        readNumber(row, "count"),
      ]),
    );
    const eventRow = eventRows[0] ?? {};
    const customerRow = customerRows[0] ?? {};
    const retention = new Map(
      retentionRows.map((row) => [readString(row, "currency"), row]),
    );
    const payerMap = new Map(
      payerRows.map((row) => [readString(row, "currency"), readNumber(row, "payers")]),
    );
    const lifetimeNet = new Map<string, number>();

    for (const [currency, gross] of lifetimeCash.gross) {
      lifetimeNet.set(
        currency,
        gross - (lifetimeCash.refunded.get(currency) ?? 0),
      );
    }

    const currencies = sortedCurrencies(
      mergeCurrencySets(
        snapshot,
        rangeCash.gross,
        rangeCash.refunded,
        outstanding,
        lifetimeNet,
      ),
      defaultCurrency,
    );
    const currencyRows: AnalyticsOverviewCurrency[] = currencies.map(
      (currency) => {
        const snapshotRow = snapshot.get(currency);
        const mrrMinor = snapshotRow ? readNumber(snapshotRow, "mrr_minor") : 0;
        const activeSubscriptions = snapshotRow
          ? readNumber(snapshotRow, "active_subscriptions")
          : 0;
        const activeCustomers = snapshotRow
          ? readNumber(snapshotRow, "active_customers")
          : 0;
        const grossCollected = rangeCash.gross.get(currency) ?? 0;
        const refunded = rangeCash.refunded.get(currency) ?? 0;
        const netCollected = grossCollected - refunded;
        const lifetime = lifetimeNet.get(currency) ?? 0;
        const payers = payerMap.get(currency) ?? 0;

        return {
          currency,
          mrrMinor,
          arrMinor: mrrMinor * 12,
          grossCollectedMinor: grossCollected,
          refundedMinor: refunded,
          netCollectedMinor: netCollected,
          outstandingMinor: outstanding.get(currency) ?? 0,
          activeSubscriptions,
          activeCustomers,
          averageRevenuePerCustomerMinor:
            activeCustomers > 0
              ? Math.round(netCollected / activeCustomers)
              : null,
          averageSubscriptionValueMinor:
            activeSubscriptions > 0
              ? Math.round(mrrMinor / activeSubscriptions)
              : null,
          customerLifetimeValueMinor:
            payers > 0 ? Math.round(lifetime / payers) : null,
        };
      },
    );

    const retentionByCurrency = sortedCurrencies(
      [...retention.keys()],
      defaultCurrency,
    ).map((currency) => {
      const row = retention.get(currency) ?? {};
      const starting = readNumber(row, "starting_mrr");
      const churned = readNumber(row, "churned_mrr");
      const expansion = readNumber(row, "expansion_mrr");

      return {
        currency,
        startingMrrMinor: starting,
        churnedMrrMinor: churned,
        expansionMrrMinor: expansion,
        revenueChurnRateBps: percentageBps(churned, starting),
        grossRevenueRetentionBps: percentageBps(starting - churned, starting),
        netRevenueRetentionBps: percentageBps(
          starting - churned + expansion,
          starting,
        ),
      };
    });

    return {
      range: toAnalyticsRange(query),
      defaultCurrency,
      generatedAt: query.now.toISOString(),
      currencies: currencyRows,
      subscriptions: {
        active: statusCounts.get("ACTIVE") ?? 0,
        trialing: statusCounts.get("TRIALING") ?? 0,
        pastDue: statusCounts.get("PAST_DUE") ?? 0,
        paused: statusCounts.get("PAUSED") ?? 0,
        newInRange: readNumber(eventRow, "new_subscriptions"),
        canceledInRange: readNumber(eventRow, "canceled_subscriptions"),
        activeAtStart: readNumber(eventRow, "starting_subscriptions"),
        activeAtEnd: readNumber(eventRow, "ending_subscriptions"),
      },
      customers: {
        total: readNumber(customerRow, "total_customers"),
        active: readNumber(customerRow, "active_customers"),
        newInRange: readNumber(customerRow, "new_customers"),
        returningInRange: readNumber(customerRow, "returning_customers"),
        churnedInRange: readNumber(customerRow, "churned_customers"),
      },
      retention: {
        startingCustomers: readNumber(customerRow, "starting_customers"),
        churnedCustomers: readNumber(customerRow, "churned_customers"),
        customerChurnRateBps: percentageBps(
          readNumber(customerRow, "churned_customers"),
          readNumber(customerRow, "starting_customers"),
        ),
        startingSubscriptions: readNumber(
          eventRow,
          "starting_subscriptions",
        ),
        churnedSubscriptions: readNumber(
          eventRow,
          "churned_from_start",
        ),
        subscriptionRetentionBps: percentageBps(
          readNumber(eventRow, "starting_subscriptions") -
            readNumber(eventRow, "churned_from_start"),
          readNumber(eventRow, "starting_subscriptions"),
        ),
        newCustomers: readNumber(customerRow, "new_customers"),
        returningCustomers: readNumber(customerRow, "returning_customers"),
        byCurrency: retentionByCurrency,
      },
    };
  }

  async function computeRevenue(
    organizationId: string,
    query: ResolvedAnalyticsQuery,
  ): Promise<AnalyticsRevenueResponse> {
    const defaultCurrency = await getDefaultCurrency(organizationId);
    const bucketsJson = buildBucketsJson(query);

    const [invoiceRows, cashRows, subscriptionRows] = await Promise.all([
      prisma.$queryRaw<DbRow[]>(Prisma.sql`
        WITH buckets AS (
          SELECT * FROM jsonb_to_recordset(${bucketsJson}::jsonb)
            AS b(bucket_start timestamptz, bucket_end timestamptz, label text)
        )
        SELECT
          b.bucket_start,
          i.currency,
          COALESCE(SUM(i."totalMinor"), 0)::bigint AS invoiced,
          COALESCE(SUM(
            CASE WHEN i.status = 'OPEN'
              THEN GREATEST(i."totalMinor" - i."amountPaidMinor", 0)
              ELSE 0 END
          ), 0)::bigint AS outstanding
        FROM buckets b
        JOIN invoices i ON i."organizationId" = ${organizationId}
          AND i."issuedAt" >= GREATEST(b.bucket_start, ${query.from})
          AND i."issuedAt" < LEAST(b.bucket_end, ${query.toExclusive})
          AND i.status NOT IN ('DRAFT', 'VOID')
        GROUP BY b.bucket_start, i.currency
      `),
      prisma.$queryRaw<DbRow[]>(Prisma.sql`
        WITH buckets AS (
          SELECT * FROM jsonb_to_recordset(${bucketsJson}::jsonb)
            AS b(bucket_start timestamptz, bucket_end timestamptz, label text)
        ),
        events AS (${cashEventsCte(organizationId, query.from, query.toExclusive)})
        SELECT
          b.bucket_start,
          e.currency,
          COALESCE(SUM(e.gross_minor), 0)::bigint AS gross,
          COALESCE(SUM(e.refund_minor), 0)::bigint AS refunded
        FROM buckets b
        JOIN events e ON e.occurred_at >= GREATEST(b.bucket_start, ${query.from})
          AND e.occurred_at < LEAST(b.bucket_end, ${query.toExclusive})
        GROUP BY b.bucket_start, e.currency
      `),
      prisma.$queryRaw<DbRow[]>(Prisma.sql`
        WITH buckets AS (
          SELECT * FROM jsonb_to_recordset(${bucketsJson}::jsonb)
            AS b(bucket_start timestamptz, bucket_end timestamptz, label text)
        ),
        revenue_subs AS (${revenueSubsCte(organizationId)})
        SELECT
          b.bucket_start,
          s.currency,
          COUNT(*) FILTER (
            WHERE s.started_at >= GREATEST(b.bucket_start, ${query.from})
              AND s.started_at < LEAST(b.bucket_end, ${query.toExclusive})
          )::int AS new_subscriptions,
          COUNT(*) FILTER (
            WHERE s.status IN ('CANCELED', 'EXPIRED')
              AND s.access_end >= GREATEST(b.bucket_start, ${query.from})
              AND s.access_end < LEAST(b.bucket_end, ${query.toExclusive})
          )::int AS canceled_subscriptions
        FROM buckets b
        JOIN revenue_subs s ON (
          (s.started_at >= GREATEST(b.bucket_start, ${query.from})
            AND s.started_at < LEAST(b.bucket_end, ${query.toExclusive}))
          OR
          (s.status IN ('CANCELED', 'EXPIRED')
            AND s.access_end >= GREATEST(b.bucket_start, ${query.from})
            AND s.access_end < LEAST(b.bucket_end, ${query.toExclusive}))
        )
        GROUP BY b.bucket_start, s.currency
      `),
    ]);

    const points = query.buckets.map<AnalyticsRevenuePoint>((bucket) => ({
      bucketStart: bucket.start.toISOString(),
      bucketEnd: bucket.end.toISOString(),
      label: bucket.label,
      currencies: [],
    }));
    const pointMaps = points.map(
      () => new Map<string, AnalyticsRevenuePointCurrency>(),
    );

    const ensureRow = (
      index: number,
      currency: string,
    ): AnalyticsRevenuePointCurrency => {
      const existing = at(pointMaps, index).get(currency);

      if (existing) {
        return existing;
      }

      const row = currencyRowMap(currency);
      at(pointMaps, index).set(currency, row);
      return row;
    };

    for (const row of invoiceRows) {
      const index = bucketIndex(query, readDate(row, "bucket_start"));

      if (index < 0) {
        continue;
      }

      const currency = readString(row, "currency");
      const target = ensureRow(index, currency);
      target.invoicedMinor += readNumber(row, "invoiced");
      target.outstandingMinor += readNumber(row, "outstanding");
    }

    for (const row of cashRows) {
      const index = bucketIndex(query, readDate(row, "bucket_start"));

      if (index < 0) {
        continue;
      }

      const target = ensureRow(index, readString(row, "currency"));
      target.grossCollectedMinor += readNumber(row, "gross");
      target.refundedMinor += readNumber(row, "refunded");
      target.netCollectedMinor +=
        readNumber(row, "gross") - readNumber(row, "refunded");
    }

    for (const row of subscriptionRows) {
      const index = bucketIndex(query, readDate(row, "bucket_start"));

      if (index < 0) {
        continue;
      }

      const target = ensureRow(index, readString(row, "currency"));
      target.newSubscriptions += readNumber(row, "new_subscriptions");
      target.canceledSubscriptions += readNumber(row, "canceled_subscriptions");
    }

    const totals = new Map<string, AnalyticsRevenuePointCurrency>();

    points.forEach((point, index) => {
      point.currencies = sortedCurrencies(
        [...at(pointMaps, index).keys()],
        defaultCurrency,
      ).map((currency) => at(pointMaps, index).get(currency) ?? currencyRowMap(currency));

      for (const row of at(pointMaps, index).values()) {
        const total = totals.get(row.currency) ?? currencyRowMap(row.currency);
        total.invoicedMinor += row.invoicedMinor;
        total.grossCollectedMinor += row.grossCollectedMinor;
        total.refundedMinor += row.refundedMinor;
        total.netCollectedMinor += row.netCollectedMinor;
        total.outstandingMinor += row.outstandingMinor;
        total.newSubscriptions += row.newSubscriptions;
        total.canceledSubscriptions += row.canceledSubscriptions;
        totals.set(row.currency, total);
      }
    });

    return {
      range: toAnalyticsRange(query),
      defaultCurrency,
      points,
      totals: sortCurrencyAmounts(
        [...totals.values()].map((row) => ({
          currency: row.currency,
          amountMinor: row.netCollectedMinor,
        })),
        defaultCurrency,
      ).map(({ currency }) => totals.get(currency) ?? currencyRowMap(currency)),
    };
  }

  async function getMrrHistory(
    organizationId: string,
    query: ResolvedAnalyticsQuery,
  ): Promise<AnalyticsMrrResponse> {
    const defaultCurrency = await getDefaultCurrency(organizationId);
    const bucketsJson = buildBucketsJson(query);

    const [snapshotRows, newRows, churnedRows] = await Promise.all([
      prisma.$queryRaw<DbRow[]>(Prisma.sql`
        WITH buckets AS (
          SELECT * FROM jsonb_to_recordset(${bucketsJson}::jsonb)
            AS b(bucket_start timestamptz, bucket_end timestamptz, label text)
        ),
        revenue_subs AS (${revenueSubsCte(organizationId)})
        SELECT
          b.bucket_start,
          s.currency,
          COUNT(*)::int AS active_subscriptions,
          COALESCE(SUM(s.mrr_minor), 0)::bigint AS mrr_minor
        FROM buckets b
        JOIN revenue_subs s ON s.revenue_start <= LEAST(b.bucket_end, ${query.toExclusive})
          AND (s.revenue_end IS NULL OR s.revenue_end > LEAST(b.bucket_end, ${query.toExclusive}))
        GROUP BY b.bucket_start, s.currency
      `),
      prisma.$queryRaw<DbRow[]>(Prisma.sql`
        WITH buckets AS (
          SELECT * FROM jsonb_to_recordset(${bucketsJson}::jsonb)
            AS b(bucket_start timestamptz, bucket_end timestamptz, label text)
        ),
        revenue_subs AS (${revenueSubsCte(organizationId)})
        SELECT
          b.bucket_start,
          s.currency,
          COALESCE(SUM(s.mrr_minor), 0)::bigint AS new_mrr
        FROM buckets b
        JOIN revenue_subs s ON s.revenue_start >= GREATEST(b.bucket_start, ${query.from})
          AND s.revenue_start < LEAST(b.bucket_end, ${query.toExclusive})
        GROUP BY b.bucket_start, s.currency
      `),
      prisma.$queryRaw<DbRow[]>(Prisma.sql`
        WITH buckets AS (
          SELECT * FROM jsonb_to_recordset(${bucketsJson}::jsonb)
            AS b(bucket_start timestamptz, bucket_end timestamptz, label text)
        ),
        revenue_subs AS (${revenueSubsCte(organizationId)})
        SELECT
          b.bucket_start,
          s.currency,
          COALESCE(SUM(s.mrr_minor), 0)::bigint AS churned_mrr
        FROM buckets b
        JOIN revenue_subs s ON s.status IN ('CANCELED', 'EXPIRED')
          AND s.access_end >= GREATEST(b.bucket_start, ${query.from})
          AND s.access_end < LEAST(b.bucket_end, ${query.toExclusive})
          AND s.revenue_start <= GREATEST(b.bucket_start, ${query.from})
          AND (s.revenue_end IS NULL OR s.revenue_end > GREATEST(b.bucket_start, ${query.from}))
        GROUP BY b.bucket_start, s.currency
      `),
    ]);

    const points = query.buckets.map<AnalyticsMrrPoint>((bucket) => ({
      bucketStart: bucket.start.toISOString(),
      bucketEnd: bucket.end.toISOString(),
      label: bucket.label,
      activeSubscriptions: 0,
      currencies: [],
    }));
    const maps = points.map(
      () => new Map<string, AnalyticsMrrPointCurrency>(),
    );
    const ensure = (index: number, currency: string): AnalyticsMrrPointCurrency => {
      const existing = at(maps, index).get(currency);

      if (existing) {
        return existing;
      }

      const row: AnalyticsMrrPointCurrency = {
        currency,
        mrrMinor: 0,
        arrMinor: 0,
        newMrrMinor: 0,
        churnedMrrMinor: 0,
        netNewMrrMinor: 0,
      };
      at(maps, index).set(currency, row);
      return row;
    };

    for (const row of snapshotRows) {
      const index = bucketIndex(query, readDate(row, "bucket_start"));

      if (index < 0) {
        continue;
      }

      at(points, index).activeSubscriptions += readNumber(
        row,
        "active_subscriptions",
      );
      const target = ensure(index, readString(row, "currency"));
      target.mrrMinor += readNumber(row, "mrr_minor");
      target.arrMinor += readNumber(row, "mrr_minor") * 12;
    }

    for (const row of newRows) {
      const index = bucketIndex(query, readDate(row, "bucket_start"));

      if (index < 0) {
        continue;
      }

      ensure(index, readString(row, "currency")).newMrrMinor += readNumber(
        row,
        "new_mrr",
      );
    }

    for (const row of churnedRows) {
      const index = bucketIndex(query, readDate(row, "bucket_start"));

      if (index < 0) {
        continue;
      }

      ensure(index, readString(row, "currency")).churnedMrrMinor += readNumber(
        row,
        "churned_mrr",
      );
    }

    points.forEach((point, index) => {
      for (const row of at(maps, index).values()) {
        row.netNewMrrMinor = row.newMrrMinor - row.churnedMrrMinor;
      }

      point.currencies = sortedCurrencies(
        [...at(maps, index).keys()],
        defaultCurrency,
      ).map(
        (currency) =>
          at(maps, index).get(currency) ?? {
            currency,
            mrrMinor: 0,
            arrMinor: 0,
            newMrrMinor: 0,
            churnedMrrMinor: 0,
            netNewMrrMinor: 0,
          },
      );
    });

    return {
      range: toAnalyticsRange(query),
      defaultCurrency,
      points,
      latest: points[points.length - 1]?.currencies ?? [],
    };
  }

  async function getSubscriptionGrowth(
    organizationId: string,
    query: ResolvedAnalyticsQuery,
  ): Promise<AnalyticsSubscriptionGrowthResponse> {
    const defaultCurrency = await getDefaultCurrency(organizationId);
    const bucketsJson = buildBucketsJson(query);

    const [countRows, eventRows, summaryRows] = await Promise.all([
      prisma.$queryRaw<DbRow[]>(Prisma.sql`
        WITH buckets AS (
          SELECT * FROM jsonb_to_recordset(${bucketsJson}::jsonb)
            AS b(bucket_start timestamptz, bucket_end timestamptz, label text)
        ),
        revenue_subs AS (${revenueSubsCte(organizationId)})
        SELECT
          b.bucket_start,
          COUNT(*) FILTER (
            WHERE s.started_at <= GREATEST(b.bucket_start, ${query.from})
              AND (s.access_end IS NULL OR s.access_end > GREATEST(b.bucket_start, ${query.from}))
          )::int AS starting_subscriptions,
          COUNT(*) FILTER (
            WHERE s.started_at <= LEAST(b.bucket_end, ${query.toExclusive})
              AND (s.access_end IS NULL OR s.access_end > LEAST(b.bucket_end, ${query.toExclusive}))
          )::int AS ending_subscriptions
        FROM buckets b
        CROSS JOIN revenue_subs s
        GROUP BY b.bucket_start
      `),
      prisma.$queryRaw<DbRow[]>(Prisma.sql`
        WITH buckets AS (
          SELECT * FROM jsonb_to_recordset(${bucketsJson}::jsonb)
            AS b(bucket_start timestamptz, bucket_end timestamptz, label text)
        ),
        revenue_subs AS (${revenueSubsCte(organizationId)})
        SELECT
          b.bucket_start,
          s.currency,
          COUNT(*) FILTER (
            WHERE s.started_at >= GREATEST(b.bucket_start, ${query.from})
              AND s.started_at < LEAST(b.bucket_end, ${query.toExclusive})
          )::int AS new_subscriptions,
          COUNT(*) FILTER (
            WHERE s.status IN ('CANCELED', 'EXPIRED')
              AND s.access_end >= GREATEST(b.bucket_start, ${query.from})
              AND s.access_end < LEAST(b.bucket_end, ${query.toExclusive})
          )::int AS canceled_subscriptions,
          COALESCE(SUM(
            CASE WHEN s.revenue_start >= GREATEST(b.bucket_start, ${query.from})
              AND s.revenue_start < LEAST(b.bucket_end, ${query.toExclusive})
              THEN s.mrr_minor ELSE 0 END
          ), 0)::bigint AS new_mrr,
          COALESCE(SUM(
            CASE WHEN s.status IN ('CANCELED', 'EXPIRED')
              AND s.access_end >= GREATEST(b.bucket_start, ${query.from})
              AND s.access_end < LEAST(b.bucket_end, ${query.toExclusive})
              AND s.revenue_start <= GREATEST(b.bucket_start, ${query.from})
              AND (s.revenue_end IS NULL OR s.revenue_end > GREATEST(b.bucket_start, ${query.from}))
              THEN s.mrr_minor ELSE 0 END
          ), 0)::bigint AS churned_mrr
        FROM buckets b
        JOIN revenue_subs s ON (
          (s.started_at >= GREATEST(b.bucket_start, ${query.from})
            AND s.started_at < LEAST(b.bucket_end, ${query.toExclusive}))
          OR
          (s.revenue_start >= GREATEST(b.bucket_start, ${query.from})
            AND s.revenue_start < LEAST(b.bucket_end, ${query.toExclusive}))
          OR
          (s.status IN ('CANCELED', 'EXPIRED')
            AND s.access_end >= GREATEST(b.bucket_start, ${query.from})
            AND s.access_end < LEAST(b.bucket_end, ${query.toExclusive}))
        )
        GROUP BY b.bucket_start, s.currency
      `),
      prisma.$queryRaw<DbRow[]>(Prisma.sql`
        WITH revenue_subs AS (${revenueSubsCte(organizationId)})
        SELECT
          COUNT(*) FILTER (
            WHERE started_at >= ${query.from} AND started_at < ${query.toExclusive}
          )::int AS new_subscriptions,
          COUNT(*) FILTER (
            WHERE status IN ('CANCELED', 'EXPIRED')
              AND access_end >= ${query.from} AND access_end < ${query.toExclusive}
          )::int AS canceled_subscriptions,
          COUNT(*) FILTER (
            WHERE status IN ('CANCELED', 'EXPIRED')
              AND access_end >= ${query.from} AND access_end < ${query.toExclusive}
              AND started_at <= ${query.from}
          )::int AS churned_from_start,
          COUNT(*) FILTER (
            WHERE started_at <= ${query.from}
              AND (access_end IS NULL OR access_end > ${query.from})
          )::int AS starting_subscriptions,
          COUNT(*) FILTER (
            WHERE started_at <= ${query.toExclusive}
              AND (access_end IS NULL OR access_end > ${query.toExclusive})
          )::int AS ending_subscriptions
        FROM revenue_subs
      `),
    ]);

    const points = query.buckets.map<AnalyticsSubscriptionGrowthPoint>(
      (bucket) => ({
        bucketStart: bucket.start.toISOString(),
        bucketEnd: bucket.end.toISOString(),
        label: bucket.label,
        newSubscriptions: 0,
        canceledSubscriptions: 0,
        netGrowth: 0,
        startingSubscriptions: 0,
        endingSubscriptions: 0,
        growthRateBps: null,
        currencies: [],
      }),
    );
    const currencyMaps = points.map(
      () => new Map<string, AnalyticsSubscriptionGrowthPoint["currencies"][number]>(),
    );
    const countMap = new Map(
      countRows.map((row) => [readDate(row, "bucket_start")?.toISOString(), row]),
    );

    for (const row of eventRows) {
      const start = readDate(row, "bucket_start");
      const index = bucketIndex(query, start);

      if (index < 0) {
        continue;
      }

      const currency = readString(row, "currency");
      const point = at(points, index);
      point.newSubscriptions += readNumber(row, "new_subscriptions");
      point.canceledSubscriptions += readNumber(row, "canceled_subscriptions");
      const existing = at(currencyMaps, index).get(currency) ?? {
        currency,
        newMrrMinor: 0,
        churnedMrrMinor: 0,
        netMrrMinor: 0,
      };
      existing.newMrrMinor += readNumber(row, "new_mrr");
      existing.churnedMrrMinor += readNumber(row, "churned_mrr");
      existing.netMrrMinor = existing.newMrrMinor - existing.churnedMrrMinor;
      at(currencyMaps, index).set(currency, existing);
    }

    points.forEach((point, index) => {
      const count = countMap.get(
        query.buckets[index]?.start.toISOString() ?? "",
      );
      point.startingSubscriptions = count
        ? readNumber(count, "starting_subscriptions")
        : 0;
      point.endingSubscriptions = count
        ? readNumber(count, "ending_subscriptions")
        : 0;
      point.netGrowth = point.newSubscriptions - point.canceledSubscriptions;
      point.growthRateBps = percentageBps(
        point.netGrowth,
        point.startingSubscriptions,
      );
      point.currencies = sortedCurrencies(
        [...at(currencyMaps, index).keys()],
        defaultCurrency,
      ).map(
        (currency) =>
          at(currencyMaps, index).get(currency) ?? {
            currency,
            newMrrMinor: 0,
            churnedMrrMinor: 0,
            netMrrMinor: 0,
          },
      );
    });

    const summary = summaryRows[0] ?? {};

    return {
      range: toAnalyticsRange(query),
      defaultCurrency,
      points,
      summary: {
        newSubscriptions: readNumber(summary, "new_subscriptions"),
        canceledSubscriptions: readNumber(summary, "canceled_subscriptions"),
        netGrowth:
          readNumber(summary, "new_subscriptions") -
          readNumber(summary, "canceled_subscriptions"),
        startingSubscriptions: readNumber(summary, "starting_subscriptions"),
        endingSubscriptions: readNumber(summary, "ending_subscriptions"),
        growthRateBps: percentageBps(
          readNumber(summary, "new_subscriptions") -
            readNumber(summary, "canceled_subscriptions"),
          readNumber(summary, "starting_subscriptions"),
        ),
        churnRateBps: percentageBps(
          readNumber(summary, "churned_from_start"),
          readNumber(summary, "starting_subscriptions"),
        ),
      },
    };
  }

  return {
    getDefaultCurrency,
    getOverview,
    getRevenue: computeRevenue,
    getMrrHistory,
    getSubscriptionGrowth,
    async getChurn(organizationId, query) {
      const defaultCurrency = await getDefaultCurrency(organizationId);
      const summary = await getOverview(organizationId, query);
      const bucketsJson = buildBucketsJson(query);
      const [eventRows, customerPointRows] = await Promise.all([
        prisma.$queryRaw<DbRow[]>(Prisma.sql`
          WITH buckets AS (
            SELECT * FROM jsonb_to_recordset(${bucketsJson}::jsonb)
              AS b(bucket_start timestamptz, bucket_end timestamptz, label text)
          ),
          revenue_subs AS (${revenueSubsCte(organizationId)})
          SELECT
            b.bucket_start,
            s.currency,
            COUNT(*) FILTER (
              WHERE s.started_at >= GREATEST(b.bucket_start, ${query.from})
                AND s.started_at < LEAST(b.bucket_end, ${query.toExclusive})
            )::int AS new_subscriptions,
            COUNT(*) FILTER (
              WHERE s.status IN ('CANCELED', 'EXPIRED')
                AND s.access_end >= GREATEST(b.bucket_start, ${query.from})
                AND s.access_end < LEAST(b.bucket_end, ${query.toExclusive})
            )::int AS churned_subscriptions,
            COALESCE(SUM(CASE
              WHEN s.revenue_start >= GREATEST(b.bucket_start, ${query.from})
                AND s.revenue_start < LEAST(b.bucket_end, ${query.toExclusive})
              THEN s.mrr_minor ELSE 0 END), 0)::bigint AS new_mrr,
            COALESCE(SUM(CASE
              WHEN s.status IN ('CANCELED', 'EXPIRED')
                AND s.access_end >= GREATEST(b.bucket_start, ${query.from})
                AND s.access_end < LEAST(b.bucket_end, ${query.toExclusive})
                AND s.revenue_start <= GREATEST(b.bucket_start, ${query.from})
                AND (s.revenue_end IS NULL OR s.revenue_end > GREATEST(b.bucket_start, ${query.from}))
              THEN s.mrr_minor ELSE 0 END), 0)::bigint AS churned_mrr
          FROM buckets b
          JOIN revenue_subs s ON (
            (s.started_at >= GREATEST(b.bucket_start, ${query.from})
              AND s.started_at < LEAST(b.bucket_end, ${query.toExclusive}))
            OR
            (s.revenue_start >= GREATEST(b.bucket_start, ${query.from})
              AND s.revenue_start < LEAST(b.bucket_end, ${query.toExclusive}))
            OR
            (s.status IN ('CANCELED', 'EXPIRED')
              AND s.access_end >= GREATEST(b.bucket_start, ${query.from})
              AND s.access_end < LEAST(b.bucket_end, ${query.toExclusive}))
          )
          GROUP BY b.bucket_start, s.currency
        `),
        prisma.$queryRaw<DbRow[]>(Prisma.sql`
          WITH buckets AS (
            SELECT * FROM jsonb_to_recordset(${bucketsJson}::jsonb)
              AS b(bucket_start timestamptz, bucket_end timestamptz, label text)
          ),
          revenue_subs AS (${revenueSubsCte(organizationId)}),
          first_starts AS (
            SELECT customer_id, MIN(started_at) AS first_start
            FROM revenue_subs
            GROUP BY customer_id
          ),
          starting AS (
            SELECT b.bucket_start, s.customer_id
            FROM buckets b
            JOIN revenue_subs s ON s.started_at <= GREATEST(b.bucket_start, ${query.from})
              AND (s.access_end IS NULL OR s.access_end > GREATEST(b.bucket_start, ${query.from}))
            GROUP BY b.bucket_start, s.customer_id
          ),
          ending AS (
            SELECT b.bucket_start, s.customer_id
            FROM buckets b
            JOIN revenue_subs s ON s.started_at <= LEAST(b.bucket_end, ${query.toExclusive})
              AND (s.access_end IS NULL OR s.access_end > LEAST(b.bucket_end, ${query.toExclusive}))
            GROUP BY b.bucket_start, s.customer_id
          )
          SELECT
            b.bucket_start,
            (
              SELECT COUNT(*)::int FROM first_starts f
              WHERE f.first_start >= GREATEST(b.bucket_start, ${query.from})
                AND f.first_start < LEAST(b.bucket_end, ${query.toExclusive})
            ) AS new_customers,
            COUNT(*) FILTER (WHERE e.customer_id IS NULL)::int AS churned_customers
          FROM buckets b
          LEFT JOIN starting st ON st.bucket_start = b.bucket_start
          LEFT JOIN ending e ON e.bucket_start = b.bucket_start
            AND e.customer_id = st.customer_id
          GROUP BY b.bucket_start, b.bucket_end
        `),
      ]);

      const points = query.buckets.map<AnalyticsChurnPoint>((bucket) => ({
        bucketStart: bucket.start.toISOString(),
        bucketEnd: bucket.end.toISOString(),
        label: bucket.label,
        newCustomers: 0,
        churnedCustomers: 0,
        newSubscriptions: 0,
        churnedSubscriptions: 0,
        currencies: [],
      }));
      const maps = points.map(
        () => new Map<string, AnalyticsChurnPoint["currencies"][number]>(),
      );

      for (const row of eventRows) {
        const index = bucketIndex(query, readDate(row, "bucket_start"));

        if (index < 0) {
          continue;
        }

        const point = at(points, index);
        point.newSubscriptions += readNumber(row, "new_subscriptions");
        point.churnedSubscriptions += readNumber(row, "churned_subscriptions");
        const currency = readString(row, "currency");
        const existing = at(maps, index).get(currency) ?? {
          currency,
          newMrrMinor: 0,
          churnedMrrMinor: 0,
        };
        existing.newMrrMinor += readNumber(row, "new_mrr");
        existing.churnedMrrMinor += readNumber(row, "churned_mrr");
        at(maps, index).set(currency, existing);
      }

      for (const row of customerPointRows) {
        const index = bucketIndex(query, readDate(row, "bucket_start"));

        if (index < 0) {
          continue;
        }

        at(points, index).newCustomers = readNumber(row, "new_customers");
        at(points, index).churnedCustomers = readNumber(row, "churned_customers");
      }

      points.forEach((point, index) => {
        point.currencies = sortedCurrencies(
          [...at(maps, index).keys()],
          defaultCurrency,
        ).map(
          (currency) =>
            at(maps, index).get(currency) ?? {
              currency,
              newMrrMinor: 0,
              churnedMrrMinor: 0,
            },
        );
      });

      return {
        range: toAnalyticsRange(query),
        defaultCurrency,
        summary: summary.retention,
        points,
      };
    },
    async getCustomers(organizationId, query, page) {
      const defaultCurrency = await getDefaultCurrency(organizationId);
      const bucketsJson = buildBucketsJson(query);
      const offset = (page.page - 1) * page.pageSize;
      const epoch = new Date("1970-01-01T00:00:00.000Z");

      const [overview, pointRows, topRows] = await Promise.all([
        getOverview(organizationId, query),
        prisma.$queryRaw<DbRow[]>(Prisma.sql`
          WITH buckets AS (
            SELECT * FROM jsonb_to_recordset(${bucketsJson}::jsonb)
              AS b(bucket_start timestamptz, bucket_end timestamptz, label text)
          ),
          revenue_subs AS (${revenueSubsCte(organizationId)}),
          first_starts AS (
            SELECT customer_id, MIN(started_at) AS first_start
            FROM revenue_subs
            GROUP BY customer_id
          ),
          starting AS (
            SELECT b.bucket_start, s.customer_id
            FROM buckets b
            JOIN revenue_subs s ON s.started_at <= GREATEST(b.bucket_start, ${query.from})
              AND (s.access_end IS NULL OR s.access_end > GREATEST(b.bucket_start, ${query.from}))
            GROUP BY b.bucket_start, s.customer_id
          ),
          ending AS (
            SELECT b.bucket_start, s.customer_id
            FROM buckets b
            JOIN revenue_subs s ON s.started_at <= LEAST(b.bucket_end, ${query.toExclusive})
              AND (s.access_end IS NULL OR s.access_end > LEAST(b.bucket_end, ${query.toExclusive}))
            GROUP BY b.bucket_start, s.customer_id
          )
          SELECT
            b.bucket_start,
            (
              SELECT COUNT(*)::int FROM first_starts f
              WHERE f.first_start >= GREATEST(b.bucket_start, ${query.from})
                AND f.first_start < LEAST(b.bucket_end, ${query.toExclusive})
            ) AS new_customers,
            (
              SELECT COUNT(DISTINCT s.customer_id)::int
              FROM revenue_subs s
              WHERE s.started_at >= GREATEST(b.bucket_start, ${query.from})
                AND s.started_at < LEAST(b.bucket_end, ${query.toExclusive})
                AND EXISTS (
                  SELECT 1 FROM revenue_subs prior
                  WHERE prior.customer_id = s.customer_id
                    AND prior.started_at < GREATEST(b.bucket_start, ${query.from})
                )
            ) AS returning_customers,
            COUNT(*) FILTER (WHERE e.customer_id IS NULL)::int AS churned_customers,
            COUNT(DISTINCT e.customer_id)::int AS active_customers
          FROM buckets b
          LEFT JOIN starting st ON st.bucket_start = b.bucket_start
          LEFT JOIN ending e ON e.bucket_start = b.bucket_start
            AND e.customer_id = st.customer_id
          GROUP BY b.bucket_start, b.bucket_end
        `),
        prisma.$queryRaw<DbRow[]>(Prisma.sql`
          WITH events AS (${cashEventsCte(organizationId, epoch, query.toExclusive)}),
          cash AS (
            SELECT i."customerId" AS customer_id, e.currency,
              COALESCE(SUM(e.gross_minor - e.refund_minor), 0)::bigint AS net
            FROM events e
            JOIN invoices i ON i.id = e.invoice_id
            GROUP BY i."customerId", e.currency
          ),
          outstanding AS (
            SELECT "customerId" AS customer_id, currency,
              COALESCE(SUM("totalMinor" - "amountPaidMinor"), 0)::bigint AS amount
            FROM invoices
            WHERE "organizationId" = ${organizationId}
              AND status = 'OPEN'
              AND "totalMinor" > "amountPaidMinor"
            GROUP BY "customerId", currency
          ),
          active_subs AS (
            SELECT customer_id, currency, COUNT(*)::int AS active_count
            FROM (
              SELECT * FROM (${revenueSubsCte(organizationId)}) rs
            ) s
            WHERE s.started_at <= ${query.toExclusive}
              AND (s.access_end IS NULL OR s.access_end > ${query.toExclusive})
            GROUP BY customer_id, currency
          ),
          firsts AS (
            SELECT customer_id, currency, MIN(started_at) AS first_start
            FROM (${revenueSubsCte(organizationId)}) s
            GROUP BY customer_id, currency
          ),
          last_payments AS (
            SELECT i."customerId" AS customer_id, e.currency, MAX(e.occurred_at) AS last_payment
            FROM events e
            JOIN invoices i ON i.id = e.invoice_id
            WHERE e.gross_minor > 0
            GROUP BY i."customerId", e.currency
          ),
          keys AS (
            SELECT customer_id, currency FROM cash
            UNION
            SELECT customer_id, currency FROM outstanding
            UNION
            SELECT customer_id, currency FROM active_subs
          )
          SELECT
            c.id,
            c.name,
            c.email,
            k.currency,
            COALESCE(cash.net, 0)::bigint AS net,
            COALESCE(outstanding.amount, 0)::bigint AS outstanding,
            COALESCE(active_subs.active_count, 0)::int AS active_subscriptions,
            firsts.first_start,
            last_payments.last_payment,
            COUNT(*) OVER()::int AS total
          FROM keys k
          JOIN customers c ON c.id = k.customer_id AND c."organizationId" = ${organizationId}
          LEFT JOIN cash ON cash.customer_id = k.customer_id AND cash.currency = k.currency
          LEFT JOIN outstanding ON outstanding.customer_id = k.customer_id AND outstanding.currency = k.currency
          LEFT JOIN active_subs ON active_subs.customer_id = k.customer_id AND active_subs.currency = k.currency
          LEFT JOIN firsts ON firsts.customer_id = k.customer_id AND firsts.currency = k.currency
          LEFT JOIN last_payments ON last_payments.customer_id = k.customer_id AND last_payments.currency = k.currency
          ORDER BY net DESC, outstanding DESC, c.name ASC
          LIMIT ${page.pageSize} OFFSET ${offset}
        `),
      ]);

      const points = query.buckets.map<AnalyticsCustomersResponse["points"][number]>(
        (bucket) => ({
          bucketStart: bucket.start.toISOString(),
          bucketEnd: bucket.end.toISOString(),
          label: bucket.label,
          newCustomers: 0,
          returningCustomers: 0,
          churnedCustomers: 0,
          activeCustomers: 0,
        }),
      );

      for (const row of pointRows) {
        const index = bucketIndex(query, readDate(row, "bucket_start"));

        if (index < 0) {
          continue;
        }

        at(points, index).newCustomers = readNumber(row, "new_customers");
        at(points, index).returningCustomers = readNumber(row, "returning_customers");
        at(points, index).churnedCustomers = readNumber(row, "churned_customers");
        at(points, index).activeCustomers = readNumber(row, "active_customers");
      }

      const items: AnalyticsCustomerRow[] = topRows.map((row) => {
        const firstStart = readDate(row, "first_start");
        const lastPayment = readDate(row, "last_payment");

        return {
          customerId: readString(row, "id"),
          name: readString(row, "name"),
          email: readString(row, "email"),
          currency: readString(row, "currency"),
          netCollectedMinor: readNumber(row, "net"),
          outstandingMinor: readNumber(row, "outstanding"),
          activeSubscriptions: readNumber(row, "active_subscriptions"),
          firstSubscribedAt: firstStart?.toISOString() ?? null,
          lastPaymentAt: lastPayment?.toISOString() ?? null,
        };
      });
      const total = topRows[0] ? readNumber(topRows[0], "total") : 0;
      const overviewCurrencies = new Map(
        overview.currencies.map((row) => [row.currency, row]),
      );

      return {
        range: toAnalyticsRange(query),
        defaultCurrency,
        summary: {
          totalCustomers: overview.customers.total,
          activeCustomers: overview.customers.active,
          newCustomers: overview.customers.newInRange,
          returningCustomers: overview.customers.returningInRange,
          churnedCustomers: overview.customers.churnedInRange,
          customerChurnRateBps: overview.retention.customerChurnRateBps,
          averageRevenuePerCustomer: sortedCurrencies(
            [...overviewCurrencies.keys()],
            defaultCurrency,
          ).map((currency) => ({
            currency,
            amountMinor:
              overviewCurrencies.get(currency)
                ?.averageRevenuePerCustomerMinor ?? 0,
          })),
          customerLifetimeValue: sortedCurrencies(
            [...overviewCurrencies.keys()],
            defaultCurrency,
          ).map((currency) => ({
            currency,
            amountMinor:
              overviewCurrencies.get(currency)?.customerLifetimeValueMinor ?? 0,
          })),
        },
        points,
        topCustomers: {
          items,
          page: page.page,
          pageSize: page.pageSize,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / page.pageSize),
        },
      };
    },
    async getPlans(organizationId, query, page) {
      const defaultCurrency = await getDefaultCurrency(organizationId);
      const offset = (page.page - 1) * page.pageSize;
      const rows = await prisma.$queryRaw<DbRow[]>(Prisma.sql`
        WITH revenue_subs AS (${revenueSubsCte(organizationId)}),
        plan_groups AS (
          SELECT
            plan_id,
            currency,
            interval::text AS interval,
            MAX(plan_name) AS plan_name,
            MAX(plan_code) AS plan_code
          FROM revenue_subs
          GROUP BY plan_id, currency, interval
        ),
        active AS (
          SELECT plan_id, currency, interval::text AS interval,
            COUNT(*)::int AS active_subscriptions,
            COALESCE(SUM(mrr_minor), 0)::bigint AS mrr_minor
          FROM revenue_subs
          WHERE revenue_start <= ${query.toExclusive}
            AND (revenue_end IS NULL OR revenue_end > ${query.toExclusive})
          GROUP BY plan_id, currency, interval
        ),
        events AS (
          SELECT plan_id, currency, interval::text AS interval,
            COUNT(*) FILTER (
              WHERE started_at >= ${query.from} AND started_at < ${query.toExclusive}
            )::int AS new_subscriptions,
            COUNT(*) FILTER (
              WHERE status IN ('CANCELED', 'EXPIRED')
                AND access_end >= ${query.from} AND access_end < ${query.toExclusive}
            )::int AS canceled_subscriptions,
            COUNT(*) FILTER (
              WHERE status IN ('CANCELED', 'EXPIRED')
                AND access_end >= ${query.from} AND access_end < ${query.toExclusive}
                AND started_at <= ${query.from}
            )::int AS churned_from_start,
            COUNT(*) FILTER (
              WHERE started_at <= ${query.from}
                AND (access_end IS NULL OR access_end > ${query.from})
            )::int AS starting_subscriptions
          FROM revenue_subs
          GROUP BY plan_id, currency, interval
        ),
        events_cash AS (${cashEventsCte(organizationId, query.from, query.toExclusive)}),
        cash AS (
          SELECT s.plan_id, s.currency, s.interval::text AS interval,
            COALESCE(SUM(e.gross_minor - e.refund_minor), 0)::bigint AS net
          FROM events_cash e
          JOIN invoices i ON i.id = e.invoice_id
          JOIN revenue_subs s ON s.id = i."subscriptionId"
          GROUP BY s.plan_id, s.currency, s.interval
        ),
        outstanding AS (
          SELECT s.plan_id, s.currency, s.interval::text AS interval,
            COALESCE(SUM(GREATEST(i."totalMinor" - i."amountPaidMinor", 0)), 0)::bigint AS amount
          FROM invoices i
          JOIN revenue_subs s ON s.id = i."subscriptionId"
          WHERE i."organizationId" = ${organizationId}
            AND i.status = 'OPEN'
            AND i."totalMinor" > i."amountPaidMinor"
          GROUP BY s.plan_id, s.currency, s.interval
        ),
        combined AS (
          SELECT
            g.plan_id,
            g.plan_name,
            g.plan_code,
            g.interval,
            g.currency,
            COALESCE(a.active_subscriptions, 0)::int AS active_subscriptions,
            COALESCE(ev.new_subscriptions, 0)::int AS new_subscriptions,
            COALESCE(ev.canceled_subscriptions, 0)::int AS canceled_subscriptions,
            COALESCE(ev.churned_from_start, 0)::int AS churned_from_start,
            COALESCE(ev.starting_subscriptions, 0)::int AS starting_subscriptions,
            COALESCE(a.mrr_minor, 0)::bigint AS mrr_minor,
            COALESCE(c.net, 0)::bigint AS net_collected,
            COALESCE(o.amount, 0)::bigint AS outstanding
          FROM plan_groups g
          LEFT JOIN active a ON a.plan_id = g.plan_id AND a.currency = g.currency AND a.interval = g.interval
          LEFT JOIN events ev ON ev.plan_id = g.plan_id AND ev.currency = g.currency AND ev.interval = g.interval
          LEFT JOIN cash c ON c.plan_id = g.plan_id AND c.currency = g.currency AND c.interval = g.interval
          LEFT JOIN outstanding o ON o.plan_id = g.plan_id AND o.currency = g.currency AND o.interval = g.interval
        )
        SELECT *, COUNT(*) OVER()::int AS total
        FROM combined
        ORDER BY mrr_minor DESC, active_subscriptions DESC, plan_name ASC
        LIMIT ${page.pageSize} OFFSET ${offset}
      `);

      const items: AnalyticsPlanRow[] = rows.map((row) => {
        const mrrMinor = readNumber(row, "mrr_minor");
        const canceled = readNumber(row, "canceled_subscriptions");
        const churnedFromStart = readNumber(row, "churned_from_start");
        const starting = readNumber(row, "starting_subscriptions");

        return {
          planId: readString(row, "plan_id"),
          planName: readString(row, "plan_name"),
          planCode: readString(row, "plan_code"),
          interval: readString(row, "interval"),
          currency: readString(row, "currency"),
          activeSubscriptions: readNumber(row, "active_subscriptions"),
          newSubscriptions: readNumber(row, "new_subscriptions"),
          canceledSubscriptions: canceled,
          mrrMinor,
          arrMinor: mrrMinor * 12,
          netCollectedMinor: readNumber(row, "net_collected"),
          outstandingMinor: readNumber(row, "outstanding"),
          churnRateBps: percentageBps(churnedFromStart, starting),
        };
      });
      const total = rows[0] ? readNumber(rows[0], "total") : 0;

      return {
        range: toAnalyticsRange(query),
        defaultCurrency,
        items,
        page: page.page,
        pageSize: page.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / page.pageSize),
      };
    },
    async getInvoices(organizationId, query) {
      const defaultCurrency = await getDefaultCurrency(organizationId);
      const bucketsJson = buildBucketsJson(query);
      const [invoiceRows, invoiceSeriesRows, cashSeriesRows, cash, agingRows] =
        await Promise.all([
          prisma.$queryRaw<DbRow[]>(Prisma.sql`
            SELECT
              currency,
              COALESCE(SUM("totalMinor"), 0)::bigint AS invoiced,
              COALESCE(SUM("amountPaidMinor"), 0)::bigint AS collected,
              COALESCE(SUM(
                CASE WHEN status = 'OPEN'
                  THEN GREATEST("totalMinor" - "amountPaidMinor", 0)
                  ELSE 0 END
              ), 0)::bigint AS outstanding,
              COALESCE(SUM(
                CASE WHEN status = 'OPEN' AND "dueAt" IS NOT NULL AND "dueAt" < ${query.now}
                  THEN GREATEST("totalMinor" - "amountPaidMinor", 0)
                  ELSE 0 END
              ), 0)::bigint AS overdue,
              COALESCE(SUM(
                CASE WHEN status = 'UNCOLLECTIBLE'
                  THEN GREATEST("totalMinor" - "amountPaidMinor", 0)
                  ELSE 0 END
              ), 0)::bigint AS uncollectible
            FROM invoices
            WHERE "organizationId" = ${organizationId}
              AND "issuedAt" >= ${query.from}
              AND "issuedAt" < ${query.toExclusive}
              AND status NOT IN ('DRAFT', 'VOID')
            GROUP BY currency
          `),
          prisma.$queryRaw<DbRow[]>(Prisma.sql`
            WITH buckets AS (
              SELECT * FROM jsonb_to_recordset(${bucketsJson}::jsonb)
                AS b(bucket_start timestamptz, bucket_end timestamptz, label text)
            )
            SELECT
              b.bucket_start,
              i.currency,
              COALESCE(SUM(i."totalMinor"), 0)::bigint AS invoiced,
              COALESCE(SUM(
                CASE WHEN i.status = 'OPEN'
                  THEN GREATEST(i."totalMinor" - i."amountPaidMinor", 0)
                  ELSE 0 END
              ), 0)::bigint AS outstanding
            FROM buckets b
            JOIN invoices i ON i."organizationId" = ${organizationId}
              AND i."issuedAt" >= GREATEST(b.bucket_start, ${query.from})
              AND i."issuedAt" < LEAST(b.bucket_end, ${query.toExclusive})
              AND i.status NOT IN ('DRAFT', 'VOID')
            GROUP BY b.bucket_start, i.currency
          `),
          prisma.$queryRaw<DbRow[]>(Prisma.sql`
            WITH buckets AS (
              SELECT * FROM jsonb_to_recordset(${bucketsJson}::jsonb)
                AS b(bucket_start timestamptz, bucket_end timestamptz, label text)
            ),
            events AS (${cashEventsCte(organizationId, query.from, query.toExclusive)})
            SELECT
              b.bucket_start,
              e.currency,
              COALESCE(SUM(e.gross_minor), 0)::bigint AS gross,
              COALESCE(SUM(e.refund_minor), 0)::bigint AS refunded
            FROM buckets b
            JOIN events e ON e.occurred_at >= GREATEST(b.bucket_start, ${query.from})
              AND e.occurred_at < LEAST(b.bucket_end, ${query.toExclusive})
            GROUP BY b.bucket_start, e.currency
          `),
          cashTotals(prisma, organizationId, query.from, query.toExclusive),
          prisma.$queryRaw<DbRow[]>(Prisma.sql`
            SELECT
              currency,
              CASE
                WHEN "dueAt" IS NULL OR "dueAt" >= ${query.now} THEN 'current'
                WHEN ${query.now} - "dueAt" <= interval '30 days' THEN '1-30'
                WHEN ${query.now} - "dueAt" <= interval '60 days' THEN '31-60'
                WHEN ${query.now} - "dueAt" <= interval '90 days' THEN '61-90'
                ELSE '90+'
              END AS aging_bucket,
              COALESCE(SUM("totalMinor" - "amountPaidMinor"), 0)::bigint AS amount
            FROM invoices
            WHERE "organizationId" = ${organizationId}
              AND status = 'OPEN'
              AND "totalMinor" > "amountPaidMinor"
            GROUP BY currency, aging_bucket
          `),
        ]);

      const rowMap = new Map<string, AnalyticsInvoiceCurrency>();

      const ensureRow = (currency: string): AnalyticsInvoiceCurrency => {
        const existing = rowMap.get(currency);

        if (existing) {
          return existing;
        }

        const row: AnalyticsInvoiceCurrency = {
          currency,
          invoicedMinor: 0,
          collectedMinor: 0,
          cashCollectedMinor: 0,
          refundedMinor: 0,
          outstandingMinor: 0,
          overdueMinor: 0,
          uncollectibleMinor: 0,
          collectionRateBps: null,
        };
        rowMap.set(currency, row);
        return row;
      };

      for (const row of invoiceRows) {
        const target = ensureRow(readString(row, "currency"));
        target.invoicedMinor += readNumber(row, "invoiced");
        target.collectedMinor += readNumber(row, "collected");
        target.outstandingMinor += readNumber(row, "outstanding");
        target.overdueMinor += readNumber(row, "overdue");
        target.uncollectibleMinor += readNumber(row, "uncollectible");
      }

      for (const [currency, amount] of cash.gross) {
        ensureRow(currency).cashCollectedMinor += amount;
      }

      for (const [currency, amount] of cash.refunded) {
        ensureRow(currency).refundedMinor += amount;
      }

      for (const row of rowMap.values()) {
        row.collectionRateBps = percentageBps(
          row.collectedMinor,
          row.invoicedMinor,
        );
      }

      const aging: AnalyticsInvoiceAgingRow[] = agingRows.map((row) => ({
        bucket: readString(row, "aging_bucket") as AnalyticsAgingBucket,
        currency: readString(row, "currency"),
        amountMinor: readNumber(row, "amount"),
      }));

      const points = query.buckets.map<AnalyticsInvoicesResponse["points"][number]>(
        (bucket) => ({
          bucketStart: bucket.start.toISOString(),
          bucketEnd: bucket.end.toISOString(),
          label: bucket.label,
          currencies: [],
        }),
      );
      const pointMaps = points.map(
        () => new Map<string, AnalyticsInvoicePointCurrency>(),
      );
      const ensurePoint = (
        index: number,
        currency: string,
      ): AnalyticsInvoicePointCurrency => {
        const existing = at(pointMaps, index).get(currency);

        if (existing) {
          return existing;
        }

        const row: AnalyticsInvoicePointCurrency = {
          currency,
          invoicedMinor: 0,
          cashCollectedMinor: 0,
          refundedMinor: 0,
          outstandingMinor: 0,
        };
        at(pointMaps, index).set(currency, row);
        return row;
      };

      for (const row of invoiceSeriesRows) {
        const index = bucketIndex(query, readDate(row, "bucket_start"));

        if (index < 0) {
          continue;
        }

        const target = ensurePoint(index, readString(row, "currency"));
        target.invoicedMinor += readNumber(row, "invoiced");
        target.outstandingMinor += readNumber(row, "outstanding");
      }

      for (const row of cashSeriesRows) {
        const index = bucketIndex(query, readDate(row, "bucket_start"));

        if (index < 0) {
          continue;
        }

        const target = ensurePoint(index, readString(row, "currency"));
        target.cashCollectedMinor += readNumber(row, "gross");
        target.refundedMinor += readNumber(row, "refunded");
      }

      points.forEach((point, index) => {
        point.currencies = sortedCurrencies(
          [...at(pointMaps, index).keys()],
          defaultCurrency,
        ).map(
          (currency) =>
            at(pointMaps, index).get(currency) ?? {
              currency,
              invoicedMinor: 0,
              cashCollectedMinor: 0,
              refundedMinor: 0,
              outstandingMinor: 0,
            },
        );
      });

      return {
        range: toAnalyticsRange(query),
        defaultCurrency,
        currencies: sortedCurrencies([...rowMap.keys()], defaultCurrency).map(
          (currency) => rowMap.get(currency) ?? ensureRow(currency),
        ),
        aging,
        points,
      };
    },
    async getRevenueReportRows(organizationId, query) {
      const report = await computeRevenue(organizationId, query);

      return report.points.flatMap<AnalyticsRevenueReportRow>((point) =>
        point.currencies.map((row) => ({
          ...row,
          bucketStart: point.bucketStart,
          bucketEnd: point.bucketEnd,
          label: point.label,
        })),
      );
    },
    async getSubscriptionReportRows(organizationId, query) {
      const report = await this.getPlans(organizationId, query, {
        page: 1,
        pageSize: 10_000,
      });

      return report.items.map<AnalyticsSubscriptionReportRow>((row) => ({
        ...row,
        reportFrom: query.fromDate,
        reportTo: query.toDate,
      }));
    },
  };
}
