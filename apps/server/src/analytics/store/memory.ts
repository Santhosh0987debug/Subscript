import type {
  AnalyticsCustomerRow,
  AnalyticsInvoiceAgingRow,
  AnalyticsInvoiceCurrency,
  AnalyticsInvoicePointCurrency,
  AnalyticsMrrPointCurrency,
  AnalyticsOverviewCurrency,
  AnalyticsOverviewResponse,
  AnalyticsPlanRow,
  AnalyticsRevenuePointCurrency,
} from "@subscript/shared";
import { ANALYTICS_AGING_BUCKETS } from "@subscript/shared";
import type { CustomerRecord, CustomerStore } from "../../customers/types.js";
import type { InvoiceRecord, InvoiceStore } from "../../invoices/types.js";
import type { PlanStore } from "../../plans/types.js";
import type {
  SubscriptionRecord,
  SubscriptionStore,
} from "../../subscriptions/types.js";
import {
  addToCurrency,
  agingBucketForInvoice,
  cashEventsFromInvoices,
  earliestDate,
  invoiceOutstandingMinor,
  invoiceOverdueMinor,
  isAccessActiveAt,
  isChurnedSubscription,
  isRevenueActiveAt,
  isWithin,
  normalizeMrrMinor,
  percentageBps,
  sortCurrencyAmounts,
  subscriptionAccessEnd,
  subscriptionRevenueStart,
} from "../calc.js";
import type { ResolvedAnalyticsQuery } from "../range.js";
import { toAnalyticsRange } from "../range.js";
import type {
  AnalyticsRevenueReportRow,
  AnalyticsStore,
  AnalyticsSubscriptionReportRow,
} from "../types.js";

export interface MemoryAnalyticsStoreOptions {
  customerStore: CustomerStore;
  planStore: PlanStore;
  subscriptionStore: SubscriptionStore;
  invoiceStore: InvoiceStore;
  defaultCurrency?: string;
}

interface OrganizationData {
  customers: CustomerRecord[];
  subscriptions: SubscriptionRecord[];
  invoices: InvoiceRecord[];
}

interface CashSummary {
  gross: Map<string, number>;
  refunded: Map<string, number>;
  byCustomerCurrency: Map<string, number>;
  lastPaymentByCustomerCurrency: Map<string, Date>;
  payerCustomers: Map<string, Set<string>>;
}

interface CommonMetrics {
  defaultCurrency: string;
  currentStatusCounts: Record<string, number>;
  mrr: Map<string, number>;
  activeSubscriptions: Map<string, number>;
  activeCustomers: Map<string, Set<string>>;
  gross: Map<string, number>;
  refunded: Map<string, number>;
  net: Map<string, number>;
  outstanding: Map<string, number>;
  lifetimeNet: Map<string, number>;
  lifetimePayers: Map<string, Set<string>>;
  newSubscriptions: number;
  canceledSubscriptions: number;
  churnedFromStartSubscriptions: number;
  startingSubscriptions: number;
  endingSubscriptions: number;
  newCustomers: Set<string>;
  returningCustomers: Set<string>;
  churnedCustomers: Set<string>;
  startingCustomers: Set<string>;
  startingMrr: Map<string, number>;
  churnedMrr: Map<string, number>;
  expansionMrr: Map<string, number>;
}

function customerKey(customerId: string, currency: string): string {
  return `${customerId}\u0000${currency}`;
}

function firstSubscriptionStarts(
  subscriptions: readonly SubscriptionRecord[],
): Map<string, Date> {
  const first = new Map<string, Date>();

  for (const subscription of subscriptions) {
    const current = first.get(subscription.customerId);

    if (!current || subscription.startedAt.getTime() < current.getTime()) {
      first.set(subscription.customerId, subscription.startedAt);
    }
  }

  return first;
}

function cashSummary(
  invoices: readonly InvoiceRecord[],
  from: Date | null,
  toExclusive: Date | null,
): CashSummary {
  const gross = new Map<string, number>();
  const refunded = new Map<string, number>();
  const byCustomerCurrency = new Map<string, number>();
  const lastPaymentByCustomerCurrency = new Map<string, Date>();
  const payerCustomers = new Map<string, Set<string>>();
  const events = cashEventsFromInvoices(invoices);

  for (const event of events) {
    if (!event.paidAt) {
      continue;
    }

    if (from && event.paidAt.getTime() < from.getTime()) {
      continue;
    }

    if (toExclusive && event.paidAt.getTime() >= toExclusive.getTime()) {
      continue;
    }

    if (event.grossMinor > 0) {
      addToCurrency(gross, event.currency, event.grossMinor);
      const key = customerKey(event.customerId, event.currency);
      addToCurrency(byCustomerCurrency, key, event.grossMinor);

      const previous = lastPaymentByCustomerCurrency.get(key);

      if (!previous || event.paidAt.getTime() > previous.getTime()) {
        lastPaymentByCustomerCurrency.set(key, event.paidAt);
      }

      const payers = payerCustomers.get(event.currency) ?? new Set<string>();
      payers.add(event.customerId);
      payerCustomers.set(event.currency, payers);
    }

    if (event.refundMinor > 0) {
      addToCurrency(refunded, event.currency, event.refundMinor);
      const key = customerKey(event.customerId, event.currency);
      addToCurrency(byCustomerCurrency, key, -event.refundMinor);
    }
  }

  return {
    gross,
    refunded,
    byCustomerCurrency,
    lastPaymentByCustomerCurrency,
    payerCustomers,
  };
}

function buildCommonMetrics(
  data: OrganizationData,
  query: ResolvedAnalyticsQuery,
  defaultCurrency: string,
): CommonMetrics {
  const currentStatusCounts: Record<string, number> = {};
  const mrr = new Map<string, number>();
  const activeSubscriptions = new Map<string, number>();
  const activeCustomers = new Map<string, Set<string>>();
  const outstanding = new Map<string, number>();
  const startingMrr = new Map<string, number>();
  const churnedMrr = new Map<string, number>();
  const expansionMrr = new Map<string, number>();
  const firstStarts = firstSubscriptionStarts(data.subscriptions);
  const customerIdsActiveAtStart = new Set<string>();
  const revenueActiveAtStartByCustomer = new Map<
    string,
    SubscriptionRecord[]
  >();
  const customersActiveAtEnd = new Set<string>();
  const newCustomers = new Set<string>();
  const returningCustomers = new Set<string>();
  let newSubscriptions = 0;
  let canceledSubscriptions = 0;
  let churnedFromStartSubscriptions = 0;
  let startingSubscriptions = 0;
  let endingSubscriptions = 0;

  for (const subscription of data.subscriptions) {
    currentStatusCounts[subscription.status] =
      (currentStatusCounts[subscription.status] ?? 0) + 1;
    const mrrMinor = normalizeMrrMinor(
      subscription.unitAmountMinor,
      subscription.quantity,
      subscription.interval,
    );

    if (isRevenueActiveAt(subscription, query.from)) {
      addToCurrency(startingMrr, subscription.currency, mrrMinor);
      const active =
        revenueActiveAtStartByCustomer.get(subscription.customerId) ?? [];
      active.push(subscription);
      revenueActiveAtStartByCustomer.set(subscription.customerId, active);
    }

    if (isAccessActiveAt(subscription, query.from)) {
      startingSubscriptions += 1;
      customerIdsActiveAtStart.add(subscription.customerId);
    }

    if (isRevenueActiveAt(subscription, query.toExclusive)) {
      addToCurrency(mrr, subscription.currency, mrrMinor);
      activeSubscriptions.set(
        subscription.currency,
        (activeSubscriptions.get(subscription.currency) ?? 0) + 1,
      );
      const customers =
        activeCustomers.get(subscription.currency) ?? new Set<string>();
      customers.add(subscription.customerId);
      activeCustomers.set(subscription.currency, customers);
    }

    if (isAccessActiveAt(subscription, query.toExclusive)) {
      endingSubscriptions += 1;
      customersActiveAtEnd.add(subscription.customerId);
    }

    if (
      isWithin(subscription.startedAt, query.from, query.toExclusive)
    ) {
      newSubscriptions += 1;
    }

    if (isChurnedSubscription(subscription, query.from, query.toExclusive)) {
      canceledSubscriptions += 1;

      if (isAccessActiveAt(subscription, query.from)) {
        churnedFromStartSubscriptions += 1;
      }

      if (isRevenueActiveAt(subscription, query.from)) {
        addToCurrency(churnedMrr, subscription.currency, mrrMinor);
      }
    }

    if (
      isWithin(
        subscriptionRevenueStart(subscription),
        query.from,
        query.toExclusive,
      ) &&
      (revenueActiveAtStartByCustomer.get(subscription.customerId) ?? []).some(
        (prior) => prior.id !== subscription.id,
      )
    ) {
      addToCurrency(expansionMrr, subscription.currency, mrrMinor);
    }
  }

  for (const [customerId, firstStart] of firstStarts) {
    if (isWithin(firstStart, query.from, query.toExclusive)) {
      newCustomers.add(customerId);
    }
  }

  for (const subscription of data.subscriptions) {
    if (!isWithin(subscription.startedAt, query.from, query.toExclusive)) {
      continue;
    }

    const firstStart = firstStarts.get(subscription.customerId);

    if (firstStart && firstStart.getTime() < query.from.getTime()) {
      returningCustomers.add(subscription.customerId);
    }
  }

  for (const invoice of data.invoices) {
    const balance = invoiceOutstandingMinor(invoice);

    if (balance > 0) {
      addToCurrency(outstanding, invoice.currency, balance);
    }
  }

  const cash = cashSummary(data.invoices, query.from, query.toExclusive);
  const lifetime = cashSummary(data.invoices, null, query.toExclusive);
  const net = new Map(cash.gross);
  const churnedCustomers = new Set<string>();

  for (const [currency, amount] of cash.refunded) {
    addToCurrency(net, currency, -amount);
  }

  for (const customerId of customerIdsActiveAtStart) {
    if (!customersActiveAtEnd.has(customerId)) {
      churnedCustomers.add(customerId);
    }
  }

  return {
    defaultCurrency,
    currentStatusCounts,
    mrr,
    activeSubscriptions,
    activeCustomers,
    gross: cash.gross,
    refunded: cash.refunded,
    net,
    outstanding,
    lifetimeNet: new Map(
      [...lifetime.gross.entries()].map(([currency, amount]) => {
        const refunded = lifetime.refunded.get(currency) ?? 0;
        return [currency, amount - refunded];
      }),
    ),
    lifetimePayers: lifetime.payerCustomers,
    newSubscriptions,
    canceledSubscriptions,
    churnedFromStartSubscriptions,
    startingSubscriptions,
    endingSubscriptions,
    newCustomers,
    returningCustomers,
    churnedCustomers,
    startingCustomers: customerIdsActiveAtStart,
    startingMrr,
    churnedMrr,
    expansionMrr,
  };
}

function retentionByCurrency(
  metrics: CommonMetrics,
): AnalyticsOverviewResponse["retention"]["byCurrency"] {
  const currencies = new Set([
    ...metrics.startingMrr.keys(),
    ...metrics.churnedMrr.keys(),
    ...metrics.expansionMrr.keys(),
  ]);

  return [...currencies]
    .map((currency) => {
      const starting = metrics.startingMrr.get(currency) ?? 0;
      const churned = metrics.churnedMrr.get(currency) ?? 0;
      const expansion = metrics.expansionMrr.get(currency) ?? 0;

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
    })
    .sort((left, right) => {
      if (left.currency === metrics.defaultCurrency) {
        return -1;
      }

      if (right.currency === metrics.defaultCurrency) {
        return 1;
      }

      return left.currency.localeCompare(right.currency);
    });
}

function retentionSummary(
  metrics: CommonMetrics,
): AnalyticsOverviewResponse["retention"] {
  return {
    startingCustomers: metrics.startingCustomers.size,
    churnedCustomers: metrics.churnedCustomers.size,
    customerChurnRateBps: percentageBps(
      metrics.churnedCustomers.size,
      metrics.startingCustomers.size,
    ),
    startingSubscriptions: metrics.startingSubscriptions,
    churnedSubscriptions: metrics.churnedFromStartSubscriptions,
    subscriptionRetentionBps: percentageBps(
      metrics.startingSubscriptions - metrics.churnedFromStartSubscriptions,
      metrics.startingSubscriptions,
    ),
    newCustomers: metrics.newCustomers.size,
    returningCustomers: metrics.returningCustomers.size,
    byCurrency: retentionByCurrency(metrics),
  };
}

function emptyRevenuePointCurrency(
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

function addRevenueRow(
  rows: Map<string, AnalyticsRevenuePointCurrency>,
  currency: string,
): AnalyticsRevenuePointCurrency {
  const existing = rows.get(currency);

  if (existing) {
    return existing;
  }

  const row = emptyRevenuePointCurrency(currency);
  rows.set(currency, row);
  return row;
}

function clampBucket(
  bucket: { start: Date; end: Date },
  query: ResolvedAnalyticsQuery,
): { start: Date; end: Date } {
  return {
    start: new Date(Math.max(bucket.start.getTime(), query.from.getTime())),
    end: new Date(
      Math.min(bucket.end.getTime(), query.toExclusive.getTime()),
    ),
  };
}

/** Reads a value that must exist because the index came from a matching bucket. */
function at<T>(values: readonly T[], index: number): T {
  const value = values[index];

  if (value === undefined) {
    throw new Error(`Analytics bucket index ${index} is out of range.`);
  }

  return value;
}

export function createMemoryAnalyticsStore(
  options: MemoryAnalyticsStoreOptions,
): AnalyticsStore {
  const defaultCurrency = options.defaultCurrency ?? "USD";

  async function loadOrganization(
    organizationId: string,
  ): Promise<OrganizationData> {
    const [customerResult, subscriptionResult, invoiceResult] =
      await Promise.all([
        options.customerStore.list(organizationId, {
          search: null,
          status: "ALL",
          sort: "createdAt",
          direction: "asc",
          page: 1,
          pageSize: 1_000_000,
        }),
        options.subscriptionStore.list(organizationId, {
          search: null,
          status: "ALL",
          sort: "createdAt",
          direction: "asc",
          page: 1,
          pageSize: 1_000_000,
        }),
        options.invoiceStore.list(organizationId, {
          search: null,
          status: "ALL",
          subscriptionId: null,
          customerId: null,
          sort: "createdAt",
          direction: "asc",
          page: 1,
          pageSize: 1_000_000,
        }),
      ]);

    return {
      customers: customerResult.items,
      subscriptions: subscriptionResult.items,
      invoices: invoiceResult.items,
    };
  }

  return {
    async getDefaultCurrency() {
      return defaultCurrency;
    },

    async getOverview(organizationId, query) {
      const data = await loadOrganization(organizationId);
      const metrics = buildCommonMetrics(data, query, defaultCurrency);
      const currencies = new Set([
        ...metrics.mrr.keys(),
        ...metrics.gross.keys(),
        ...metrics.outstanding.keys(),
        ...metrics.activeCustomers.keys(),
      ]);
      const currencyRows: AnalyticsOverviewCurrency[] = [...currencies]
        .map((currency) => {
          const activeSubscriptions =
            metrics.activeSubscriptions.get(currency) ?? 0;
          const activeCustomers =
            metrics.activeCustomers.get(currency)?.size ?? 0;
          const netCollected = metrics.net.get(currency) ?? 0;
          const lifetimeNet = metrics.lifetimeNet.get(currency) ?? 0;
          const lifetimePayers =
            metrics.lifetimePayers.get(currency)?.size ?? 0;

          return {
            currency,
            mrrMinor: metrics.mrr.get(currency) ?? 0,
            arrMinor: (metrics.mrr.get(currency) ?? 0) * 12,
            grossCollectedMinor: metrics.gross.get(currency) ?? 0,
            refundedMinor: metrics.refunded.get(currency) ?? 0,
            netCollectedMinor: netCollected,
            outstandingMinor: metrics.outstanding.get(currency) ?? 0,
            activeSubscriptions,
            activeCustomers,
            averageRevenuePerCustomerMinor:
              activeCustomers > 0
                ? Math.round(netCollected / activeCustomers)
                : null,
            averageSubscriptionValueMinor:
              activeSubscriptions > 0
                ? Math.round(
                    (metrics.mrr.get(currency) ?? 0) / activeSubscriptions,
                  )
                : null,
            customerLifetimeValueMinor:
              lifetimePayers > 0
                ? Math.round(lifetimeNet / lifetimePayers)
                : null,
          };
        })
        .sort((left, right) => {
          if (left.currency === defaultCurrency) {
            return -1;
          }

          if (right.currency === defaultCurrency) {
            return 1;
          }

          return left.currency.localeCompare(right.currency);
        });

      return {
        range: toAnalyticsRange(query),
        defaultCurrency,
        generatedAt: query.now.toISOString(),
        currencies: currencyRows,
        subscriptions: {
          active: metrics.currentStatusCounts.ACTIVE ?? 0,
          trialing: metrics.currentStatusCounts.TRIALING ?? 0,
          pastDue: metrics.currentStatusCounts.PAST_DUE ?? 0,
          paused: metrics.currentStatusCounts.PAUSED ?? 0,
          newInRange: metrics.newSubscriptions,
          canceledInRange: metrics.canceledSubscriptions,
          activeAtStart: metrics.startingSubscriptions,
          activeAtEnd: metrics.endingSubscriptions,
        },
        customers: {
          total: data.customers.length,
          active: metrics.activeCustomers.size > 0
            ? new Set(
                [...metrics.activeCustomers.values()].flatMap((set) => [
                  ...set,
                ]),
              ).size
            : 0,
          newInRange: metrics.newCustomers.size,
          returningInRange: metrics.returningCustomers.size,
          churnedInRange: metrics.churnedCustomers.size,
        },
        retention: retentionSummary(metrics),
      };
    },

    async getRevenue(organizationId, query) {
      const data = await loadOrganization(organizationId);
      const points = query.buckets.map((bucket) => ({
        bucketStart: bucket.start.toISOString(),
        bucketEnd: bucket.end.toISOString(),
        label: bucket.label,
        currencies: [] as AnalyticsRevenuePointCurrency[],
      }));
      const pointRows = points.map(
        () => new Map<string, AnalyticsRevenuePointCurrency>(),
      );

      for (const invoice of data.invoices) {
        if (
          !invoice.issuedAt ||
          invoice.status === "DRAFT" ||
          invoice.status === "VOID"
        ) {
          continue;
        }

        const index = query.buckets.findIndex((bucket) => {
          const clamped = clampBucket(bucket, query);
          return (
            invoice.issuedAt !== null &&
            invoice.issuedAt.getTime() >= clamped.start.getTime() &&
            invoice.issuedAt.getTime() < clamped.end.getTime()
          );
        });

        if (index < 0) {
          continue;
        }

        const row = addRevenueRow(at(pointRows, index), invoice.currency);
        row.invoicedMinor += invoice.totalMinor;
        row.outstandingMinor += invoiceOutstandingMinor(invoice);
      }

      const events = cashEventsFromInvoices(data.invoices);

      for (const event of events) {
        if (!event.paidAt) {
          continue;
        }

        const index = query.buckets.findIndex((bucket) => {
          const clamped = clampBucket(bucket, query);
          return (
            event.paidAt !== null &&
            event.paidAt.getTime() >= clamped.start.getTime() &&
            event.paidAt.getTime() < clamped.end.getTime()
          );
        });

        if (index < 0) {
          continue;
        }

        const row = addRevenueRow(at(pointRows, index), event.currency);
        row.grossCollectedMinor += event.grossMinor;
        row.refundedMinor += event.refundMinor;
        row.netCollectedMinor += event.grossMinor - event.refundMinor;
      }

      for (const subscription of data.subscriptions) {
        if (isWithin(subscription.startedAt, query.from, query.toExclusive)) {
          const index = query.buckets.findIndex((bucket) => {
            const clamped = clampBucket(bucket, query);
            return (
              subscription.startedAt.getTime() >= clamped.start.getTime() &&
              subscription.startedAt.getTime() < clamped.end.getTime()
            );
          });

          if (index >= 0) {
            addRevenueRow(
              at(pointRows, index),
              subscription.currency,
            ).newSubscriptions += 1;
          }
        }

        const accessEnd = subscriptionAccessEnd(subscription);

        if (
          isChurnedSubscription(subscription, query.from, query.toExclusive) &&
          accessEnd
        ) {
          const index = query.buckets.findIndex((bucket) => {
            const clamped = clampBucket(bucket, query);
            return (
              accessEnd.getTime() >= clamped.start.getTime() &&
              accessEnd.getTime() < clamped.end.getTime()
            );
          });

          if (index >= 0) {
            addRevenueRow(
              at(pointRows, index),
              subscription.currency,
            ).canceledSubscriptions += 1;
          }
        }
      }

      const totals = new Map<string, AnalyticsRevenuePointCurrency>();

      points.forEach((point, index) => {
        point.currencies = sortCurrencyAmounts(
          [...at(pointRows, index).values()].map((row) => ({
            currency: row.currency,
            amountMinor: row.invoicedMinor,
          })),
          defaultCurrency,
        ).map(({ currency }) => at(pointRows, index).get(currency) ?? emptyRevenuePointCurrency(currency));

        for (const row of at(pointRows, index).values()) {
          const total = totals.get(row.currency) ?? emptyRevenuePointCurrency(row.currency);
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
        ).map(({ currency }) => totals.get(currency) ?? emptyRevenuePointCurrency(currency)),
      };
    },

    async getMrrHistory(organizationId, query) {
      const data = await loadOrganization(organizationId);
      const points = query.buckets.map((bucket) => {
        const clamped = clampBucket(bucket, query);
        const mrr = new Map<string, number>();
        const newMrr = new Map<string, number>();
        const churnedMrr = new Map<string, number>();
        let activeSubscriptions = 0;

        for (const subscription of data.subscriptions) {
          const mrrMinor = normalizeMrrMinor(
            subscription.unitAmountMinor,
            subscription.quantity,
            subscription.interval,
          );

          if (isRevenueActiveAt(subscription, clamped.end)) {
            addToCurrency(mrr, subscription.currency, mrrMinor);
            activeSubscriptions += 1;
          }

          if (
            isWithin(
              subscriptionRevenueStart(subscription),
              clamped.start,
              clamped.end,
            )
          ) {
            addToCurrency(newMrr, subscription.currency, mrrMinor);
          }

          if (
            isChurnedSubscription(subscription, clamped.start, clamped.end) &&
            isRevenueActiveAt(subscription, clamped.start)
          ) {
            addToCurrency(churnedMrr, subscription.currency, mrrMinor);
          }
        }

        const currencies = new Set([
          ...mrr.keys(),
          ...newMrr.keys(),
          ...churnedMrr.keys(),
        ]);

        return {
          bucketStart: bucket.start.toISOString(),
          bucketEnd: bucket.end.toISOString(),
          label: bucket.label,
          activeSubscriptions,
          currencies: [...currencies]
            .map<AnalyticsMrrPointCurrency>((currency) => {
              const value = mrr.get(currency) ?? 0;

              return {
                currency,
                mrrMinor: value,
                arrMinor: value * 12,
                newMrrMinor: newMrr.get(currency) ?? 0,
                churnedMrrMinor: churnedMrr.get(currency) ?? 0,
                netNewMrrMinor:
                  (newMrr.get(currency) ?? 0) -
                  (churnedMrr.get(currency) ?? 0),
              };
            })
            .sort((left, right) => {
              if (left.currency === defaultCurrency) {
                return -1;
              }

              if (right.currency === defaultCurrency) {
                return 1;
              }

              return left.currency.localeCompare(right.currency);
            }),
        };
      });

      return {
        range: toAnalyticsRange(query),
        defaultCurrency,
        points,
        latest: points[points.length - 1]?.currencies ?? [],
      };
    },

    async getSubscriptionGrowth(organizationId, query) {
      const data = await loadOrganization(organizationId);
      const points = query.buckets.map((bucket) => {
        const clamped = clampBucket(bucket, query);
        const newMrr = new Map<string, number>();
        const churnedMrr = new Map<string, number>();
        let newSubscriptions = 0;
        let canceledSubscriptions = 0;
        let startingSubscriptions = 0;
        let endingSubscriptions = 0;

        for (const subscription of data.subscriptions) {
          const mrrMinor = normalizeMrrMinor(
            subscription.unitAmountMinor,
            subscription.quantity,
            subscription.interval,
          );

          if (isAccessActiveAt(subscription, clamped.start)) {
            startingSubscriptions += 1;
          }

          if (isAccessActiveAt(subscription, clamped.end)) {
            endingSubscriptions += 1;
          }

          if (isWithin(subscription.startedAt, clamped.start, clamped.end)) {
            newSubscriptions += 1;
          }

          if (
            isWithin(
              subscriptionRevenueStart(subscription),
              clamped.start,
              clamped.end,
            )
          ) {
            addToCurrency(newMrr, subscription.currency, mrrMinor);
          }

          if (
            isChurnedSubscription(subscription, clamped.start, clamped.end)
          ) {
            canceledSubscriptions += 1;

            if (isRevenueActiveAt(subscription, clamped.start)) {
              addToCurrency(churnedMrr, subscription.currency, mrrMinor);
            }
          }
        }

        const currencies = new Set([...newMrr.keys(), ...churnedMrr.keys()]);

        return {
          bucketStart: bucket.start.toISOString(),
          bucketEnd: bucket.end.toISOString(),
          label: bucket.label,
          newSubscriptions,
          canceledSubscriptions,
          netGrowth: newSubscriptions - canceledSubscriptions,
          startingSubscriptions,
          endingSubscriptions,
          growthRateBps: percentageBps(
            newSubscriptions - canceledSubscriptions,
            startingSubscriptions,
          ),
          currencies: [...currencies]
            .map((currency) => ({
              currency,
              newMrrMinor: newMrr.get(currency) ?? 0,
              churnedMrrMinor: churnedMrr.get(currency) ?? 0,
              netMrrMinor:
                (newMrr.get(currency) ?? 0) -
                (churnedMrr.get(currency) ?? 0),
            }))
            .sort((left, right) => {
              if (left.currency === defaultCurrency) {
                return -1;
              }

              if (right.currency === defaultCurrency) {
                return 1;
              }

              return left.currency.localeCompare(right.currency);
            }),
        };
      });
      const metrics = buildCommonMetrics(data, query, defaultCurrency);

      return {
        range: toAnalyticsRange(query),
        defaultCurrency,
        points,
        summary: {
          newSubscriptions: metrics.newSubscriptions,
          canceledSubscriptions: metrics.canceledSubscriptions,
          netGrowth: metrics.newSubscriptions - metrics.canceledSubscriptions,
          startingSubscriptions: metrics.startingSubscriptions,
          endingSubscriptions: metrics.endingSubscriptions,
          growthRateBps: percentageBps(
            metrics.newSubscriptions - metrics.canceledSubscriptions,
            metrics.startingSubscriptions,
          ),
          churnRateBps: percentageBps(
            metrics.churnedFromStartSubscriptions,
            metrics.startingSubscriptions,
          ),
        },
      };
    },

    async getChurn(organizationId, query) {
      const data = await loadOrganization(organizationId);
      const metrics = buildCommonMetrics(data, query, defaultCurrency);
      const firstStarts = firstSubscriptionStarts(data.subscriptions);
      const points = query.buckets.map((bucket) => {
        const clamped = clampBucket(bucket, query);
        const startingCustomers = new Set<string>();
        const endingCustomers = new Set<string>();
        const newCustomerSet = new Set<string>();
        const returningCustomerSet = new Set<string>();
        const newMrr = new Map<string, number>();
        const churnedMrr = new Map<string, number>();
        let newSubscriptions = 0;
        let churnedSubscriptions = 0;

        for (const subscription of data.subscriptions) {
          const mrrMinor = normalizeMrrMinor(
            subscription.unitAmountMinor,
            subscription.quantity,
            subscription.interval,
          );

          if (isAccessActiveAt(subscription, clamped.start)) {
            startingCustomers.add(subscription.customerId);
          }

          if (isAccessActiveAt(subscription, clamped.end)) {
            endingCustomers.add(subscription.customerId);
          }

          if (isWithin(subscription.startedAt, clamped.start, clamped.end)) {
            newSubscriptions += 1;
            const firstStart = firstStarts.get(subscription.customerId);

            if (firstStart) {
              if (firstStart.getTime() >= clamped.start.getTime()) {
                newCustomerSet.add(subscription.customerId);
              } else {
                returningCustomerSet.add(subscription.customerId);
              }
            }
          }

          if (
            isWithin(
              subscriptionRevenueStart(subscription),
              clamped.start,
              clamped.end,
            )
          ) {
            addToCurrency(newMrr, subscription.currency, mrrMinor);
          }

          if (
            isChurnedSubscription(subscription, clamped.start, clamped.end)
          ) {
            churnedSubscriptions += 1;

            if (isRevenueActiveAt(subscription, clamped.start)) {
              addToCurrency(churnedMrr, subscription.currency, mrrMinor);
            }
          }
        }

        const currencies = new Set([...newMrr.keys(), ...churnedMrr.keys()]);
        let churnedCustomers = 0;

        for (const customerId of startingCustomers) {
          if (!endingCustomers.has(customerId)) {
            churnedCustomers += 1;
          }
        }

        return {
          bucketStart: bucket.start.toISOString(),
          bucketEnd: bucket.end.toISOString(),
          label: bucket.label,
          newCustomers: newCustomerSet.size,
          churnedCustomers,
          newSubscriptions,
          churnedSubscriptions,
          currencies: [...currencies]
            .map((currency) => ({
              currency,
              newMrrMinor: newMrr.get(currency) ?? 0,
              churnedMrrMinor: churnedMrr.get(currency) ?? 0,
            }))
            .sort((left, right) => {
              if (left.currency === defaultCurrency) {
                return -1;
              }

              if (right.currency === defaultCurrency) {
                return 1;
              }

              return left.currency.localeCompare(right.currency);
            }),
        };
      });

      return {
        range: toAnalyticsRange(query),
        defaultCurrency,
        summary: retentionSummary(metrics),
        points,
      };
    },

    async getCustomers(organizationId, query, page) {
      const data = await loadOrganization(organizationId);
      const metrics = buildCommonMetrics(data, query, defaultCurrency);
      const firstStarts = firstSubscriptionStarts(data.subscriptions);
      const customerById = new Map(
        data.customers.map((customer) => [customer.id, customer]),
      );
      const lifetime = cashSummary(data.invoices, null, query.toExclusive);
      const rangeCash = cashSummary(
        data.invoices,
        query.from,
        query.toExclusive,
      );
      const outstandingByCustomerCurrency = new Map<string, number>();

      for (const invoice of data.invoices) {
        const balance = invoiceOutstandingMinor(invoice);

        if (balance > 0) {
          addToCurrency(
            outstandingByCustomerCurrency,
            customerKey(invoice.customerId, invoice.currency),
            balance,
          );
        }
      }

      const points = query.buckets.map((bucket) => {
        const clamped = clampBucket(bucket, query);
        const startingCustomers = new Set<string>();
        const endingCustomers = new Set<string>();
        const newCustomerSet = new Set<string>();
        const returningCustomerSet = new Set<string>();

        for (const subscription of data.subscriptions) {
          if (isAccessActiveAt(subscription, clamped.start)) {
            startingCustomers.add(subscription.customerId);
          }

          if (isAccessActiveAt(subscription, clamped.end)) {
            endingCustomers.add(subscription.customerId);
          }

          if (isWithin(subscription.startedAt, clamped.start, clamped.end)) {
            const firstStart = firstStarts.get(subscription.customerId);

            if (firstStart) {
              if (firstStart.getTime() >= clamped.start.getTime()) {
                newCustomerSet.add(subscription.customerId);
              } else {
                returningCustomerSet.add(subscription.customerId);
              }
            }
          }
        }

        const churnedCustomers = [...startingCustomers].filter(
          (customerId) => !endingCustomers.has(customerId),
        ).length;

        return {
          bucketStart: bucket.start.toISOString(),
          bucketEnd: bucket.end.toISOString(),
          label: bucket.label,
          newCustomers: newCustomerSet.size,
          returningCustomers: returningCustomerSet.size,
          churnedCustomers,
          activeCustomers: endingCustomers.size,
        };
      });

      const rowKeys = new Set<string>([
        ...rangeCash.byCustomerCurrency.keys(),
        ...outstandingByCustomerCurrency.keys(),
      ]);

      for (const subscription of data.subscriptions) {
        if (
          isAccessActiveAt(subscription, query.toExclusive) ||
          lifetime.byCustomerCurrency.has(
            customerKey(subscription.customerId, subscription.currency),
          )
        ) {
          rowKeys.add(customerKey(subscription.customerId, subscription.currency));
        }
      }

      const rows = [...rowKeys]
        .map((key): AnalyticsCustomerRow | null => {
          const [customerId = "", currency = ""] = key.split("\u0000");
          const customer = customerById.get(customerId);

          if (!customer) {
            return null;
          }

          const activeSubscriptions = data.subscriptions.filter(
            (subscription) =>
              subscription.customerId === customerId &&
              subscription.currency === currency &&
              isAccessActiveAt(subscription, query.toExclusive),
          ).length;
          const firstSubscribedAt = earliestDate(
            data.subscriptions
              .filter(
                (subscription) =>
                  subscription.customerId === customerId &&
                  subscription.currency === currency,
              )
              .map((subscription) => subscription.startedAt),
          );

          return {
            customerId,
            name: customer.name,
            email: customer.email,
            currency,
            netCollectedMinor: rangeCash.byCustomerCurrency.get(key) ?? 0,
            outstandingMinor: outstandingByCustomerCurrency.get(key) ?? 0,
            activeSubscriptions,
            firstSubscribedAt: firstSubscribedAt?.toISOString() ?? null,
            lastPaymentAt:
              lifetime.lastPaymentByCustomerCurrency
                .get(key)
                ?.toISOString() ?? null,
          };
        })
        .filter((row): row is AnalyticsCustomerRow => row !== null)
        .sort((left, right) => {
          if (right.netCollectedMinor !== left.netCollectedMinor) {
            return right.netCollectedMinor - left.netCollectedMinor;
          }

          if (right.outstandingMinor !== left.outstandingMinor) {
            return right.outstandingMinor - left.outstandingMinor;
          }

          return left.name.localeCompare(right.name);
        });
      const total = rows.length;
      const start = (page.page - 1) * page.pageSize;
      const items = rows.slice(start, start + page.pageSize);
      const currencies = new Set([
        ...metrics.net.keys(),
        ...metrics.activeCustomers.keys(),
        ...metrics.lifetimeNet.keys(),
      ]);

      return {
        range: toAnalyticsRange(query),
        defaultCurrency,
        summary: {
          totalCustomers: data.customers.length,
          activeCustomers: new Set(
            [...metrics.activeCustomers.values()].flatMap((set) => [...set]),
          ).size,
          newCustomers: metrics.newCustomers.size,
          returningCustomers: metrics.returningCustomers.size,
          churnedCustomers: metrics.churnedCustomers.size,
          customerChurnRateBps: percentageBps(
            metrics.churnedCustomers.size,
            metrics.startingCustomers.size,
          ),
          averageRevenuePerCustomer: sortCurrencyAmounts(
            [...currencies].map((currency) => {
              const activeCustomers =
                metrics.activeCustomers.get(currency)?.size ?? 0;
              const net = metrics.net.get(currency) ?? 0;
              return {
                currency,
                amountMinor:
                  activeCustomers > 0
                    ? Math.round(net / activeCustomers)
                    : 0,
              };
            }),
            defaultCurrency,
          ),
          customerLifetimeValue: sortCurrencyAmounts(
            [...currencies].map((currency) => {
              const payers = metrics.lifetimePayers.get(currency)?.size ?? 0;
              const net = metrics.lifetimeNet.get(currency) ?? 0;
              return {
                currency,
                amountMinor: payers > 0 ? Math.round(net / payers) : 0,
              };
            }),
            defaultCurrency,
          ),
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
      const data = await loadOrganization(organizationId);
      const groups = new Map<
        string,
        {
          planId: string;
          planName: string;
          planCode: string;
          interval: string;
          currency: string;
          activeSubscriptions: number;
          newSubscriptions: number;
          canceledSubscriptions: number;
          churnedFromStartSubscriptions: number;
          startingSubscriptions: number;
          mrrMinor: number;
          collectedMinor: number;
          outstandingMinor: number;
        }
      >();
      const subscriptionToGroup = new Map<string, string>();

      for (const subscription of data.subscriptions) {
        const key = `${subscription.planId}\u0000${subscription.currency}\u0000${subscription.interval}`;
        const group = groups.get(key) ?? {
          planId: subscription.planId,
          planName: subscription.planName,
          planCode: subscription.planCode,
          interval: subscription.interval,
          currency: subscription.currency,
          activeSubscriptions: 0,
          newSubscriptions: 0,
          canceledSubscriptions: 0,
          churnedFromStartSubscriptions: 0,
          startingSubscriptions: 0,
          mrrMinor: 0,
          collectedMinor: 0,
          outstandingMinor: 0,
        };
        const mrrMinor = normalizeMrrMinor(
          subscription.unitAmountMinor,
          subscription.quantity,
          subscription.interval,
        );

        if (isRevenueActiveAt(subscription, query.toExclusive)) {
          group.activeSubscriptions += 1;
          group.mrrMinor += mrrMinor;
        }

        if (isAccessActiveAt(subscription, query.from)) {
          group.startingSubscriptions += 1;
        }

        if (isWithin(subscription.startedAt, query.from, query.toExclusive)) {
          group.newSubscriptions += 1;
        }

        if (isChurnedSubscription(subscription, query.from, query.toExclusive)) {
          group.canceledSubscriptions += 1;

          if (isAccessActiveAt(subscription, query.from)) {
            group.churnedFromStartSubscriptions += 1;
          }
        }

        groups.set(key, group);
        subscriptionToGroup.set(subscription.id, key);
      }

      const cash = cashEventsFromInvoices(data.invoices);
      const groupCurrency = new Map(
        [...groups.entries()].map(([key, group]) => [key, group.currency]),
      );

      for (const event of cash) {
        if (
          !event.paidAt ||
          event.paidAt.getTime() < query.from.getTime() ||
          event.paidAt.getTime() >= query.toExclusive.getTime()
        ) {
          continue;
        }

        const key = event.subscriptionId
          ? subscriptionToGroup.get(event.subscriptionId)
          : undefined;

        if (key && groupCurrency.get(key) === event.currency) {
          const group = groups.get(key);

          if (group) {
            group.collectedMinor += event.grossMinor - event.refundMinor;
          }
        }
      }

      for (const invoice of data.invoices) {
        if (!invoice.subscriptionId) {
          continue;
        }

        const key = subscriptionToGroup.get(invoice.subscriptionId);

        if (!key) {
          continue;
        }

        const group = groups.get(key);

        if (group) {
          group.outstandingMinor += invoiceOutstandingMinor(invoice);
        }
      }

      const rows = [...groups.values()]
        .map<AnalyticsPlanRow>((group) => ({
          planId: group.planId,
          planName: group.planName,
          planCode: group.planCode,
          interval: group.interval,
          currency: group.currency,
          activeSubscriptions: group.activeSubscriptions,
          newSubscriptions: group.newSubscriptions,
          canceledSubscriptions: group.canceledSubscriptions,
          mrrMinor: group.mrrMinor,
          arrMinor: group.mrrMinor * 12,
          netCollectedMinor: group.collectedMinor,
          outstandingMinor: group.outstandingMinor,
          churnRateBps: percentageBps(
            group.churnedFromStartSubscriptions,
            group.startingSubscriptions,
          ),
        }))
        .sort((left, right) => {
          if (right.mrrMinor !== left.mrrMinor) {
            return right.mrrMinor - left.mrrMinor;
          }

          if (right.activeSubscriptions !== left.activeSubscriptions) {
            return right.activeSubscriptions - left.activeSubscriptions;
          }

          return left.planName.localeCompare(right.planName);
        });
      const total = rows.length;
      const start = (page.page - 1) * page.pageSize;

      return {
        range: toAnalyticsRange(query),
        defaultCurrency,
        items: rows.slice(start, start + page.pageSize),
        page: page.page,
        pageSize: page.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / page.pageSize),
      };
    },

    async getInvoices(organizationId, query) {
      const data = await loadOrganization(organizationId);
      const byCurrency = new Map<string, AnalyticsInvoiceCurrency>();
      const points = query.buckets.map((bucket) => ({
        bucketStart: bucket.start.toISOString(),
        bucketEnd: bucket.end.toISOString(),
        label: bucket.label,
        currencies: [] as AnalyticsInvoicePointCurrency[],
      }));
      const pointMaps = points.map(
        () => new Map<string, AnalyticsInvoicePointCurrency>(),
      );

      function rowFor(currency: string): AnalyticsInvoiceCurrency {
        const existing = byCurrency.get(currency);

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
        byCurrency.set(currency, row);
        return row;
      }

      for (const invoice of data.invoices) {
        if (
          invoice.status === "DRAFT" ||
          invoice.status === "VOID" ||
          !invoice.issuedAt ||
          invoice.issuedAt.getTime() < query.from.getTime() ||
          invoice.issuedAt.getTime() >= query.toExclusive.getTime()
        ) {
          continue;
        }

        const row = rowFor(invoice.currency);
        row.invoicedMinor += invoice.totalMinor;
        row.collectedMinor += invoice.amountPaidMinor;
        row.outstandingMinor += invoiceOutstandingMinor(invoice);
        row.overdueMinor += invoiceOverdueMinor(invoice, query.now);

        if (invoice.status === "UNCOLLECTIBLE") {
          row.uncollectibleMinor += Math.max(
            invoice.totalMinor - invoice.amountPaidMinor,
            0,
          );
        }

        const pointIndex = query.buckets.findIndex((bucket) => {
          const clamped = clampBucket(bucket, query);
          return (
            invoice.issuedAt !== null &&
            invoice.issuedAt.getTime() >= clamped.start.getTime() &&
            invoice.issuedAt.getTime() < clamped.end.getTime()
          );
        });

        if (pointIndex >= 0) {
          const pointRow = at(pointMaps, pointIndex);
          const existing = pointRow.get(invoice.currency) ?? {
            currency: invoice.currency,
            invoicedMinor: 0,
            cashCollectedMinor: 0,
            refundedMinor: 0,
            outstandingMinor: 0,
          };
          existing.invoicedMinor += invoice.totalMinor;
          existing.outstandingMinor += invoiceOutstandingMinor(invoice);
          pointRow.set(invoice.currency, existing);
        }
      }

      const events = cashEventsFromInvoices(data.invoices);

      for (const event of events) {
        if (
          !event.paidAt ||
          event.paidAt.getTime() < query.from.getTime() ||
          event.paidAt.getTime() >= query.toExclusive.getTime()
        ) {
          continue;
        }

        const row = rowFor(event.currency);
        row.cashCollectedMinor += event.grossMinor;
        row.refundedMinor += event.refundMinor;
        const pointIndex = query.buckets.findIndex((bucket) => {
          const clamped = clampBucket(bucket, query);
          return (
            event.paidAt !== null &&
            event.paidAt.getTime() >= clamped.start.getTime() &&
            event.paidAt.getTime() < clamped.end.getTime()
          );
        });

        if (pointIndex >= 0) {
          const pointRow = at(pointMaps, pointIndex);
          const existing = pointRow.get(event.currency) ?? {
            currency: event.currency,
            invoicedMinor: 0,
            cashCollectedMinor: 0,
            refundedMinor: 0,
            outstandingMinor: 0,
          };
          existing.cashCollectedMinor += event.grossMinor;
          existing.refundedMinor += event.refundMinor;
          pointRow.set(event.currency, existing);
        }
      }

      for (const row of byCurrency.values()) {
        row.collectionRateBps = percentageBps(
          row.collectedMinor,
          row.invoicedMinor,
        );
      }

      const agingMap = new Map<string, number>();

      for (const invoice of data.invoices) {
        const balance = invoiceOutstandingMinor(invoice);

        if (balance <= 0) {
          continue;
        }

        const bucket = agingBucketForInvoice(invoice, query.now);
        const key = `${bucket}\u0000${invoice.currency}`;
        agingMap.set(key, (agingMap.get(key) ?? 0) + balance);
      }

      const aging: AnalyticsInvoiceAgingRow[] = [];

      for (const bucket of ANALYTICS_AGING_BUCKETS) {
        const currencies = new Set(
          [...agingMap.keys()]
            .filter((key) => key.startsWith(`${bucket}\u0000`))
            .map((key) => key.split("\u0000")[1] ?? ""),
        );

        for (const currency of currencies) {
          aging.push({
            bucket,
            currency,
            amountMinor: agingMap.get(`${bucket}\u0000${currency}`) ?? 0,
          });
        }
      }

      points.forEach((point, index) => {
        point.currencies = [...at(pointMaps, index).values()].sort((left, right) =>
          left.currency.localeCompare(right.currency),
        );
      });

      return {
        range: toAnalyticsRange(query),
        defaultCurrency,
        currencies: sortCurrencyAmounts(
          [...byCurrency.values()].map((row) => ({
            currency: row.currency,
            amountMinor: row.invoicedMinor,
          })),
          defaultCurrency,
        ).map(({ currency }) => byCurrency.get(currency) ?? rowFor(currency)),
        aging,
        points,
      };
    },

    async getRevenueReportRows(organizationId, query) {
      const report = await this.getRevenue(organizationId, query);

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
