import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createPrismaAnalyticsStore } from "../src/analytics/store/prisma.js";
import { resolveAnalyticsQuery } from "../src/analytics/range.js";
import { createPrismaClient } from "../src/db/prisma.js";

/**
 * Real-PostgreSQL checks for the analytics aggregate queries. Enabled only when
 * TEST_DATABASE_URL points at a disposable database; never run this against a
 * shared application database.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("analytics PostgreSQL store", () => {
  const prisma = createPrismaClient(databaseUrl ?? "");
  const store = createPrismaAnalyticsStore(prisma);
  const organizationIds: string[] = [];

  afterAll(async () => {
    for (const organizationId of organizationIds) {
      await prisma.paymentRefund.deleteMany({ where: { organizationId } });
      await prisma.payment.deleteMany({ where: { organizationId } });
      await prisma.invoice.deleteMany({ where: { organizationId } });
      await prisma.subscription.deleteMany({ where: { organizationId } });
      await prisma.customer.deleteMany({ where: { organizationId } });
      await prisma.plan.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }

    await prisma.$disconnect();
  });

  async function seed() {
    const organizationId = randomUUID();
    const suffix = organizationId.slice(0, 8);

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Analytics PostgreSQL Workspace",
        slug: `analytics-${organizationId}`,
        defaultCurrency: "USD",
      },
    });

    const customer = async (name: string) =>
      prisma.customer.create({
        data: {
          id: randomUUID(),
          organizationId,
          name,
          email: `${name.toLowerCase().replaceAll(" ", "-")}-${suffix}@example.test`,
        },
      });

    const c1 = await customer("Alpha Customer");
    const c2 = await customer("Beta Customer");
    const c3 = await customer("Gamma Customer");
    const c4 = await customer("Delta Customer");
    const c5 = await customer("Epsilon Customer");
    const c6 = await customer("Zeta Customer");

    const monthly = await prisma.plan.create({
      data: {
        id: randomUUID(),
        organizationId,
        name: "Monthly USD",
        code: `monthly-${suffix}`,
        amountMinor: 2_900,
        currency: "USD",
        interval: "MONTH",
        trialDays: 0,
      },
    });
    const annual = await prisma.plan.create({
      data: {
        id: randomUUID(),
        organizationId,
        name: "Annual EUR",
        code: `annual-${suffix}`,
        amountMinor: 120_000,
        currency: "EUR",
        interval: "YEAR",
        trialDays: 0,
      },
    });

    const subscription = async (input: {
      customerId: string;
      planId: string;
      status: "ACTIVE" | "TRIALING" | "PAUSED" | "CANCELED";
      startedAt: string;
      periodStart: string;
      periodEnd: string;
      unitAmountMinor: number;
      currency: string;
      interval: "MONTH" | "YEAR";
      quantity?: number;
      planName: string;
      planCode: string;
      trialEndsAt?: string | null;
      canceledAt?: string | null;
      pausedAt?: string | null;
      endedAt?: string | null;
    }) =>
      prisma.subscription.create({
        data: {
          id: randomUUID(),
          organizationId,
          customerId: input.customerId,
          planId: input.planId,
          status: input.status,
          quantity: input.quantity ?? 1,
          startedAt: new Date(input.startedAt),
          trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null,
          currentPeriodStart: new Date(input.periodStart),
          currentPeriodEnd: new Date(input.periodEnd),
          canceledAt: input.canceledAt ? new Date(input.canceledAt) : null,
          pausedAt: input.pausedAt ? new Date(input.pausedAt) : null,
          endedAt: input.endedAt ? new Date(input.endedAt) : null,
          planName: input.planName,
          planCode: input.planCode,
          unitAmountMinor: input.unitAmountMinor,
          currency: input.currency,
          interval: input.interval,
          trialDays: 0,
        },
      });

    const s1 = await subscription({
      customerId: c1.id,
      planId: monthly.id,
      status: "ACTIVE",
      startedAt: "2025-12-01T00:00:00.000Z",
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-02-01T00:00:00.000Z",
      unitAmountMinor: 2_900,
      currency: "USD",
      interval: "MONTH",
      planName: monthly.name,
      planCode: monthly.code,
    });
    const s2 = await subscription({
      customerId: c2.id,
      planId: monthly.id,
      status: "ACTIVE",
      startedAt: "2026-02-01T00:00:00.000Z",
      periodStart: "2026-02-01T00:00:00.000Z",
      periodEnd: "2026-03-01T00:00:00.000Z",
      unitAmountMinor: 5_000,
      quantity: 2,
      currency: "USD",
      interval: "MONTH",
      planName: monthly.name,
      planCode: monthly.code,
    });
    const s3 = await subscription({
      customerId: c3.id,
      planId: monthly.id,
      status: "CANCELED",
      startedAt: "2025-12-01T00:00:00.000Z",
      periodStart: "2026-03-01T00:00:00.000Z",
      periodEnd: "2026-03-10T00:00:00.000Z",
      unitAmountMinor: 2_900,
      currency: "USD",
      interval: "MONTH",
      planName: monthly.name,
      planCode: monthly.code,
      canceledAt: "2026-03-10T00:00:00.000Z",
    });
    const s4 = await subscription({
      customerId: c4.id,
      planId: annual.id,
      status: "ACTIVE",
      startedAt: "2026-01-01T00:00:00.000Z",
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2027-01-01T00:00:00.000Z",
      unitAmountMinor: 120_000,
      currency: "EUR",
      interval: "YEAR",
      planName: annual.name,
      planCode: annual.code,
    });
    await subscription({
      customerId: c5.id,
      planId: monthly.id,
      status: "TRIALING",
      startedAt: "2026-03-05T00:00:00.000Z",
      periodStart: "2026-03-05T00:00:00.000Z",
      periodEnd: "2026-04-05T00:00:00.000Z",
      unitAmountMinor: 2_900,
      currency: "USD",
      interval: "MONTH",
      planName: monthly.name,
      planCode: monthly.code,
      trialEndsAt: "2026-04-05T00:00:00.000Z",
    });
    const s6 = await subscription({
      customerId: c1.id,
      planId: monthly.id,
      status: "ACTIVE",
      startedAt: "2026-02-01T00:00:00.000Z",
      periodStart: "2026-02-01T00:00:00.000Z",
      periodEnd: "2026-03-01T00:00:00.000Z",
      unitAmountMinor: 1_000,
      currency: "USD",
      interval: "MONTH",
      planName: monthly.name,
      planCode: monthly.code,
    });
    await subscription({
      customerId: c6.id,
      planId: monthly.id,
      status: "PAUSED",
      startedAt: "2025-12-01T00:00:00.000Z",
      periodStart: "2026-02-01T00:00:00.000Z",
      periodEnd: "2026-03-01T00:00:00.000Z",
      unitAmountMinor: 2_900,
      currency: "USD",
      interval: "MONTH",
      planName: monthly.name,
      planCode: monthly.code,
      pausedAt: "2026-02-15T00:00:00.000Z",
    });

    const invoice = async (input: {
      customerId: string;
      subscriptionId: string | null;
      number: string;
      status: "OPEN" | "PAID" | "UNCOLLECTIBLE";
      currency: string;
      totalMinor: number;
      amountPaidMinor: number;
      issuedAt: string;
      dueAt: string | null;
      paidAt?: string | null;
      uncollectibleAt?: string | null;
    }) =>
      prisma.invoice.create({
        data: {
          id: randomUUID(),
          organizationId,
          customerId: input.customerId,
          subscriptionId: input.subscriptionId,
          number: input.number,
          status: input.status,
          currency: input.currency,
          subtotalMinor: input.totalMinor,
          taxMinor: 0,
          totalMinor: input.totalMinor,
          amountPaidMinor: input.amountPaidMinor,
          customerName: "Analytics Customer",
          customerEmail: "analytics@example.test",
          issuedAt: new Date(input.issuedAt),
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          paidAt: input.paidAt ? new Date(input.paidAt) : null,
          uncollectibleAt: input.uncollectibleAt
            ? new Date(input.uncollectibleAt)
            : null,
        },
      });

    const i1 = await invoice({
      customerId: c1.id,
      subscriptionId: s1.id,
      number: `INV-${suffix}-1`,
      status: "OPEN",
      currency: "USD",
      totalMinor: 2_900,
      amountPaidMinor: 0,
      issuedAt: "2026-01-05T02:00:00.000Z",
      dueAt: "2026-01-10T00:00:00.000Z",
    });
    const i2 = await invoice({
      customerId: c2.id,
      subscriptionId: s2.id,
      number: `INV-${suffix}-2`,
      status: "OPEN",
      currency: "USD",
      totalMinor: 10_000,
      amountPaidMinor: 8_000,
      issuedAt: "2026-02-10T00:00:00.000Z",
      dueAt: "2026-04-15T00:00:00.000Z",
    });
    await invoice({
      customerId: c3.id,
      subscriptionId: s3.id,
      number: `INV-${suffix}-3`,
      status: "OPEN",
      currency: "USD",
      totalMinor: 2_900,
      amountPaidMinor: 0,
      issuedAt: "2026-03-01T00:00:00.000Z",
      dueAt: "2026-03-15T00:00:00.000Z",
    });
    const i4 = await invoice({
      customerId: c4.id,
      subscriptionId: s4.id,
      number: `INV-${suffix}-4`,
      status: "PAID",
      currency: "EUR",
      totalMinor: 120_000,
      amountPaidMinor: 120_000,
      issuedAt: "2026-02-15T00:00:00.000Z",
      dueAt: "2026-03-15T00:00:00.000Z",
      paidAt: "2026-02-20T00:00:00.000Z",
    });
    await invoice({
      customerId: c2.id,
      subscriptionId: s6.id,
      number: `INV-${suffix}-5`,
      status: "UNCOLLECTIBLE",
      currency: "USD",
      totalMinor: 500,
      amountPaidMinor: 0,
      issuedAt: "2026-02-20T00:00:00.000Z",
      dueAt: "2026-03-01T00:00:00.000Z",
      uncollectibleAt: "2026-02-25T00:00:00.000Z",
    });

    await prisma.payment.create({
      data: {
        id: randomUUID(),
        organizationId,
        invoiceId: i1.id,
        amountMinor: 1_000,
        currency: "USD",
        method: "CARD",
        status: "REFUNDED",
        source: "MANUAL",
        refundedAmountMinor: 1_000,
        paidAt: new Date("2026-01-20T00:00:00.000Z"),
        refundedAt: new Date("2026-03-25T00:00:00.000Z"),
      },
    });
    const p2 = await prisma.payment.create({
      data: {
        id: randomUUID(),
        organizationId,
        invoiceId: i2.id,
        amountMinor: 10_000,
        currency: "USD",
        method: "CARD",
        status: "SUCCEEDED",
        source: "GATEWAY",
        gatewayProvider: "razorpay",
        gatewayOrderId: `order-${suffix}-2`,
        gatewayPaymentId: `pay-${suffix}-2`,
        refundedAmountMinor: 2_000,
        paidAt: new Date("2026-02-12T00:00:00.000Z"),
      },
    });
    await prisma.payment.create({
      data: {
        id: randomUUID(),
        organizationId,
        invoiceId: i4.id,
        amountMinor: 120_000,
        currency: "EUR",
        method: "CARD",
        status: "SUCCEEDED",
        source: "GATEWAY",
        gatewayProvider: "razorpay",
        gatewayOrderId: `order-${suffix}-4`,
        gatewayPaymentId: `pay-${suffix}-4`,
        paidAt: new Date("2026-02-20T00:00:00.000Z"),
      },
    });
    await prisma.paymentRefund.create({
      data: {
        id: randomUUID(),
        organizationId,
        invoiceId: i2.id,
        paymentId: p2.id,
        provider: "razorpay",
        providerRefundId: `refund-${suffix}-2`,
        amountMinor: 2_000,
        currency: "USD",
        status: "SUCCEEDED",
        processedAt: new Date("2026-03-20T00:00:00.000Z"),
      },
    });

    organizationIds.push(organizationId);

    return { organizationId };
  }

  it("aggregates overview, revenue, MRR history, growth, churn, and invoices", async () => {
    const { organizationId } = await seed();
    const query = resolveAnalyticsQuery(
      {
        from: "2026-01-01",
        to: "2026-03-31",
        timezone: "UTC",
        grouping: "month",
      },
      new Date("2026-04-01T12:00:00.000Z"),
    );

    const overview = await store.getOverview(organizationId, query);
    expect(overview.currencies.map((row) => row.currency)).toEqual([
      "USD",
      "EUR",
    ]);
    const usd = overview.currencies[0];
    expect(usd).toMatchObject({
      mrrMinor: 13_900,
      arrMinor: 166_800,
      grossCollectedMinor: 11_000,
      refundedMinor: 3_000,
      netCollectedMinor: 8_000,
      outstandingMinor: 7_800,
      activeSubscriptions: 3,
      activeCustomers: 2,
      averageRevenuePerCustomerMinor: 4_000,
      averageSubscriptionValueMinor: 4_633,
      customerLifetimeValueMinor: 4_000,
    });
    expect(overview.currencies[1]).toMatchObject({
      mrrMinor: 10_000,
      arrMinor: 120_000,
      grossCollectedMinor: 120_000,
      netCollectedMinor: 120_000,
      outstandingMinor: 0,
      activeSubscriptions: 1,
      activeCustomers: 1,
      customerLifetimeValueMinor: 120_000,
    });
    expect(overview.subscriptions).toEqual({
      active: 4,
      trialing: 1,
      pastDue: 0,
      paused: 1,
      newInRange: 4,
      canceledInRange: 1,
      activeAtStart: 4,
      activeAtEnd: 6,
    });
    expect(overview.customers).toEqual({
      total: 6,
      active: 5,
      newInRange: 3,
      returningInRange: 1,
      churnedInRange: 1,
    });
    expect(overview.retention).toMatchObject({
      startingCustomers: 4,
      churnedCustomers: 1,
      customerChurnRateBps: 2_500,
      startingSubscriptions: 4,
      churnedSubscriptions: 1,
      subscriptionRetentionBps: 7_500,
      newCustomers: 3,
      returningCustomers: 1,
    });
    expect(overview.retention.byCurrency).toEqual([
      {
        currency: "USD",
        startingMrrMinor: 8_700,
        churnedMrrMinor: 2_900,
        expansionMrrMinor: 1_000,
        revenueChurnRateBps: 3_333,
        grossRevenueRetentionBps: 6_667,
        netRevenueRetentionBps: 7_816,
      },
      {
        currency: "EUR",
        startingMrrMinor: 10_000,
        churnedMrrMinor: 0,
        expansionMrrMinor: 0,
        revenueChurnRateBps: 0,
        grossRevenueRetentionBps: 10_000,
        netRevenueRetentionBps: 10_000,
      },
    ]);

    const revenue = await store.getRevenue(organizationId, query);
    expect(revenue.points.map((point) => point.label)).toEqual([
      "Jan 2026",
      "Feb 2026",
      "Mar 2026",
    ]);
    expect(revenue.totals).toEqual([
      expect.objectContaining({
        currency: "USD",
        invoicedMinor: 16_300,
        grossCollectedMinor: 11_000,
        refundedMinor: 3_000,
        netCollectedMinor: 8_000,
        outstandingMinor: 7_800,
        newSubscriptions: 3,
        canceledSubscriptions: 1,
      }),
      expect.objectContaining({
        currency: "EUR",
        invoicedMinor: 120_000,
        grossCollectedMinor: 120_000,
        refundedMinor: 0,
        netCollectedMinor: 120_000,
        newSubscriptions: 1,
        canceledSubscriptions: 0,
      }),
    ]);
    expect(revenue.points[0]?.currencies).toEqual([
      expect.objectContaining({
        currency: "USD",
        invoicedMinor: 2_900,
        grossCollectedMinor: 1_000,
        netCollectedMinor: 1_000,
        outstandingMinor: 2_900,
      }),
      expect.objectContaining({
        currency: "EUR",
        invoicedMinor: 0,
        newSubscriptions: 1,
      }),
    ]);
    expect(revenue.points[2]?.currencies[0]).toMatchObject({
      invoicedMinor: 2_900,
      grossCollectedMinor: 0,
      refundedMinor: 3_000,
      netCollectedMinor: -3_000,
      canceledSubscriptions: 1,
    });

    const mrr = await store.getMrrHistory(organizationId, query);
    expect(mrr.latest).toEqual([
      {
        currency: "USD",
        mrrMinor: 13_900,
        arrMinor: 166_800,
        newMrrMinor: 0,
        churnedMrrMinor: 2_900,
        netNewMrrMinor: -2_900,
      },
      {
        currency: "EUR",
        mrrMinor: 10_000,
        arrMinor: 120_000,
        newMrrMinor: 0,
        churnedMrrMinor: 0,
        netNewMrrMinor: 0,
      },
    ]);

    const growth = await store.getSubscriptionGrowth(organizationId, query);
    expect(growth.summary).toEqual({
      newSubscriptions: 4,
      canceledSubscriptions: 1,
      netGrowth: 3,
      startingSubscriptions: 4,
      endingSubscriptions: 6,
      growthRateBps: 7_500,
      churnRateBps: 2_500,
    });

    const churn = await store.getChurn(organizationId, query);
    expect(churn.summary).toEqual(overview.retention);
    expect(churn.points[2]).toMatchObject({
      newCustomers: 1,
      churnedCustomers: 1,
      newSubscriptions: 1,
      churnedSubscriptions: 1,
    });

    const customers = await store.getCustomers(organizationId, query, {
      page: 1,
      pageSize: 10,
    });
    expect(customers.summary).toMatchObject({
      totalCustomers: 6,
      activeCustomers: 5,
      newCustomers: 3,
      returningCustomers: 1,
      churnedCustomers: 1,
      customerChurnRateBps: 2_500,
    });
    expect(customers.topCustomers.total).toBe(6);
    const beta = customers.topCustomers.items.find(
      (row) => row.name === "Beta Customer",
    );
    expect(beta).toMatchObject({
      currency: "USD",
      netCollectedMinor: 8_000,
      outstandingMinor: 2_000,
      activeSubscriptions: 1,
    });
    expect(customers.summary.averageRevenuePerCustomer).toEqual([
      { currency: "USD", amountMinor: 4_000 },
      { currency: "EUR", amountMinor: 120_000 },
    ]);

    const plans = await store.getPlans(organizationId, query, {
      page: 1,
      pageSize: 10,
    });
    expect(plans.total).toBe(2);
    expect(plans.items[0]).toMatchObject({
      planName: "Monthly USD",
      interval: "MONTH",
      currency: "USD",
      activeSubscriptions: 3,
      newSubscriptions: 3,
      canceledSubscriptions: 1,
      mrrMinor: 13_900,
      arrMinor: 166_800,
      netCollectedMinor: 8_000,
      outstandingMinor: 7_800,
      churnRateBps: 3_333,
    });
    expect(plans.items[1]).toMatchObject({
      planName: "Annual EUR",
      interval: "YEAR",
      currency: "EUR",
      activeSubscriptions: 1,
      mrrMinor: 10_000,
      arrMinor: 120_000,
    });

    const invoices = await store.getInvoices(organizationId, query);
    expect(invoices.currencies).toEqual([
      {
        currency: "USD",
        invoicedMinor: 16_300,
        collectedMinor: 8_000,
        cashCollectedMinor: 11_000,
        refundedMinor: 3_000,
        outstandingMinor: 7_800,
        overdueMinor: 5_800,
        uncollectibleMinor: 500,
        collectionRateBps: 4_908,
      },
      {
        currency: "EUR",
        invoicedMinor: 120_000,
        collectedMinor: 120_000,
        cashCollectedMinor: 120_000,
        refundedMinor: 0,
        outstandingMinor: 0,
        overdueMinor: 0,
        uncollectibleMinor: 0,
        collectionRateBps: 10_000,
      },
    ]);
    expect(invoices.aging).toEqual(
      expect.arrayContaining([
        { bucket: "current", currency: "USD", amountMinor: 2_000 },
        { bucket: "1-30", currency: "USD", amountMinor: 2_900 },
        { bucket: "61-90", currency: "USD", amountMinor: 2_900 },
      ]),
    );
  });

  it("buckets issued invoices by the reporting timezone", async () => {
    const { organizationId } = await seed();
    const query = resolveAnalyticsQuery(
      {
        from: "2026-01-04",
        to: "2026-01-05",
        timezone: "America/Los_Angeles",
        grouping: "day",
      },
      new Date("2026-01-06T12:00:00.000Z"),
    );

    const revenue = await store.getRevenue(organizationId, query);
    expect(revenue.points).toHaveLength(2);
    expect(revenue.points[0]).toMatchObject({
      label: "Jan 4",
      currencies: [
        {
          currency: "USD",
          invoicedMinor: 2_900,
          newSubscriptions: 0,
          canceledSubscriptions: 0,
        },
      ],
    });
    expect(revenue.points[1]?.currencies).toEqual([]);
  });

  it("returns CSV report rows scoped to the selected range", async () => {
    const { organizationId } = await seed();
    const query = resolveAnalyticsQuery(
      {
        from: "2026-02-01",
        to: "2026-02-28",
        timezone: "UTC",
        grouping: "month",
      },
      new Date("2026-03-01T12:00:00.000Z"),
    );

    const revenueRows = await store.getRevenueReportRows(organizationId, query);
    expect(revenueRows).toHaveLength(2);
    expect(revenueRows.map((row) => row.currency).sort()).toEqual([
      "EUR",
      "USD",
    ]);
    expect(
      revenueRows.find((row) => row.currency === "USD"),
    ).toMatchObject({
      bucketStart: "2026-02-01T00:00:00.000Z",
      bucketEnd: "2026-03-01T00:00:00.000Z",
      invoicedMinor: 10_500,
      grossCollectedMinor: 10_000,
      refundedMinor: 0,
    });

    const subscriptionRows = await store.getSubscriptionReportRows(
      organizationId,
      query,
    );
    expect(subscriptionRows).toHaveLength(2);
    expect(subscriptionRows[0]).toMatchObject({
      reportFrom: "2026-02-01",
      reportTo: "2026-02-28",
      currency: "USD",
    });
  });
});
