import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  API_PATHS,
  type AnalyticsChurnResponse,
  type AnalyticsCustomersResponse,
  type AnalyticsInvoicesResponse,
  type AnalyticsMrrResponse,
  type AnalyticsOverviewResponse,
  type AnalyticsPlansResponse,
  type AnalyticsRevenueResponse,
  type AnalyticsSubscriptionGrowthResponse,
  type ApiErrorResponse,
  type PaymentActionResponse,
} from "@subscript/shared";
import { buildSubscriptionCsv } from "../src/analytics/csv.js";
import type { AnalyticsSubscriptionReportRow } from "../src/analytics/types.js";
import { TEST_ORIGIN, createTestApp } from "./helpers/test-app.js";
import {
  createSubscription,
  recordPayment,
  registerBillingAccount,
  setupOpenInvoice,
  setupSubscription,
} from "./helpers/billing.js";

type Agent = ReturnType<typeof request.agent>;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysFromToday(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

const TODAY = daysFromToday(0);
const RANGE_FROM = daysFromToday(-730);

function rangeQuery(overrides: Record<string, string> = {}) {
  return {
    from: RANGE_FROM,
    to: TODAY,
    grouping: "month",
    ...overrides,
  };
}

async function getOverview(
  agent: Agent,
  query: Record<string, string> = rangeQuery(),
) {
  return agent
    .get(API_PATHS.analyticsOverview)
    .query(query)
    .set("Origin", TEST_ORIGIN);
}

async function registerOwner(app: ReturnType<typeof createTestApp>["app"]) {
  return registerBillingAccount(app, {
    name: "Alice Stone",
    email: "alice@example.com",
    organizationName: "Alice Workspace",
  });
}

async function paymentAction(agent: Agent, paymentId: string, action: string) {
  const path =
    action === "refund"
      ? API_PATHS.paymentRefund(paymentId)
      : action === "succeed"
        ? API_PATHS.paymentSucceed(paymentId)
        : API_PATHS.paymentFail(paymentId);

  return agent.post(path).set("Origin", TEST_ORIGIN);
}

describe("analytics API", () => {
  it("requires authentication before returning analytics", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .get(API_PATHS.analyticsOverview)
      .query({ from: TODAY, to: TODAY })
      .set("Origin", TEST_ORIGIN);

    expect(response.status).toBe(401);
  });

  it("returns stable zero metrics with no data and no-store caching", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const response = await getOverview(agent, {
      from: TODAY,
      to: TODAY,
      grouping: "day",
    });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.body as AnalyticsOverviewResponse;

    expect(body.defaultCurrency).toBe("USD");
    expect(body.range).toMatchObject({
      from: TODAY,
      to: TODAY,
      timezone: "UTC",
      grouping: "day",
    });
    expect(body.currencies).toEqual([]);
    expect(body.subscriptions).toEqual({
      active: 0,
      trialing: 0,
      pastDue: 0,
      paused: 0,
      newInRange: 0,
      canceledInRange: 0,
      activeAtStart: 0,
      activeAtEnd: 0,
    });
    expect(body.customers).toEqual({
      total: 0,
      active: 0,
      newInRange: 0,
      returningInRange: 0,
      churnedInRange: 0,
    });
    expect(body.retention.customerChurnRateBps).toBeNull();
    expect(body.retention.subscriptionRetentionBps).toBeNull();
    expect(body.retention.byCurrency).toEqual([]);
  });

  it("normalizes monthly and annual plans without mixing currencies", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);

    await setupSubscription(agent, {
      subscription: { startDate: RANGE_FROM },
      customer: { name: "USD Monthly", email: "usd@example.test" },
      plan: {
        name: "Growth Monthly",
        price: { amountMinor: 2_900, currency: "USD" },
        interval: "MONTH",
      },
    });
    await setupSubscription(agent, {
      subscription: { startDate: RANGE_FROM },
      customer: { name: "EUR Annual", email: "eur-annual@example.test" },
      plan: {
        name: "Scale Annual",
        price: { amountMinor: 120_000, currency: "EUR" },
        interval: "YEAR",
      },
    });
    await setupSubscription(agent, {
      subscription: { startDate: RANGE_FROM },
      customer: { name: "EUR Monthly", email: "eur-monthly@example.test" },
      plan: {
        name: "Starter Monthly",
        price: { amountMinor: 1_000, currency: "EUR" },
        interval: "MONTH",
      },
    });

    const response = await getOverview(agent);
    expect(response.status).toBe(200);
    const body = response.body as AnalyticsOverviewResponse;

    expect(body.currencies.map((row) => row.currency)).toEqual(["USD", "EUR"]);
    const usd = body.currencies.find((row) => row.currency === "USD");
    const eur = body.currencies.find((row) => row.currency === "EUR");

    expect(usd).toMatchObject({
      mrrMinor: 2_900,
      arrMinor: 34_800,
      activeSubscriptions: 1,
      activeCustomers: 1,
      averageSubscriptionValueMinor: 2_900,
    });
    expect(eur).toMatchObject({
      mrrMinor: 11_000,
      arrMinor: 132_000,
      activeSubscriptions: 2,
      activeCustomers: 2,
      averageSubscriptionValueMinor: 5_500,
    });
    expect(body.subscriptions.active).toBe(3);
    expect(body.subscriptions.trialing).toBe(0);
    expect(body.subscriptions.activeAtStart).toBe(3);
    expect(body.subscriptions.activeAtEnd).toBe(3);
    expect(body.subscriptions.newInRange).toBe(3);
  });

  it("excludes trials from recurring revenue until billing starts", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);

    await setupSubscription(agent, {
      subscription: { startDate: TODAY, trialDays: 30 },
      customer: { name: "Trial Customer", email: "trial@example.test" },
      plan: {
        name: "Trial Plan",
        price: { amountMinor: 4_900, currency: "USD" },
        interval: "MONTH",
      },
    });

    const overviewResponse = await getOverview(agent, {
      from: TODAY,
      to: TODAY,
      grouping: "day",
    });
    expect(overviewResponse.status).toBe(200);
    const overview = overviewResponse.body as AnalyticsOverviewResponse;

    expect(overview.currencies).toEqual([]);
    expect(overview.subscriptions).toMatchObject({
      active: 0,
      trialing: 1,
      newInRange: 1,
      activeAtEnd: 1,
    });

    const mrrResponse = await agent
      .get(API_PATHS.analyticsMrr)
      .query({ from: TODAY, to: TODAY, grouping: "day" })
      .set("Origin", TEST_ORIGIN);
    expect(mrrResponse.status).toBe(200);
    const mrr = mrrResponse.body as AnalyticsMrrResponse;

    expect(mrr.points).toHaveLength(1);
    expect(mrr.points[0]).toMatchObject({
      activeSubscriptions: 0,
      currencies: [],
    });
    expect(mrr.latest).toEqual([]);
  });

  it("keeps recurring revenue separate from partial payments and outstanding balances", async () => {    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const setup = await setupOpenInvoice(agent, {
      subscription: { startDate: TODAY },
    });

    const partial = await recordPayment(agent, setup.invoice.id, {
      amountMinor: 1_000,
      method: "CARD",
    });
    expect(partial.status).toBe(201);

    const response = await getOverview(agent, {
      from: TODAY,
      to: TODAY,
      grouping: "day",
    });
    expect(response.status).toBe(200);
    const body = response.body as AnalyticsOverviewResponse;
    const usd = body.currencies.find((row) => row.currency === "USD");

    expect(usd).toMatchObject({
      mrrMinor: 2_900,
      arrMinor: 34_800,
      grossCollectedMinor: 1_000,
      refundedMinor: 0,
      netCollectedMinor: 1_000,
      outstandingMinor: 1_900,
      activeSubscriptions: 1,
      activeCustomers: 1,
      averageRevenuePerCustomerMinor: 1_000,
      averageSubscriptionValueMinor: 2_900,
      customerLifetimeValueMinor: 1_000,
    });
    expect(body.subscriptions.canceledInRange).toBe(0);
    expect(body.customers.newInRange).toBe(1);

    const invoices = await agent
      .get(API_PATHS.analyticsInvoices)
      .query({ from: TODAY, to: TODAY, grouping: "day" })
      .set("Origin", TEST_ORIGIN);
    expect(invoices.status).toBe(200);
    const invoiceBody = invoices.body as AnalyticsInvoicesResponse;
    expect(invoiceBody.currencies).toEqual([
      {
        currency: "USD",
        invoicedMinor: 2_900,
        collectedMinor: 1_000,
        cashCollectedMinor: 1_000,
        refundedMinor: 0,
        outstandingMinor: 1_900,
        overdueMinor: 0,
        uncollectibleMinor: 0,
        collectionRateBps: 3_448,
      },
    ]);
    expect(invoiceBody.aging).toEqual([
      { bucket: "current", currency: "USD", amountMinor: 1_900 },
    ]);

    const revenue = await agent
      .get(API_PATHS.analyticsRevenue)
      .query({ from: TODAY, to: TODAY, grouping: "day" })
      .set("Origin", TEST_ORIGIN);
    expect(revenue.status).toBe(200);
    const revenueBody = revenue.body as AnalyticsRevenueResponse;
    expect(revenueBody.totals).toEqual([
      {
        currency: "USD",
        invoicedMinor: 2_900,
        grossCollectedMinor: 1_000,
        refundedMinor: 0,
        netCollectedMinor: 1_000,
        outstandingMinor: 1_900,
        newSubscriptions: 1,
        canceledSubscriptions: 0,
      },
    ]);
    expect(revenueBody.points).toHaveLength(1);
  });

  it("nests refunds against gross cash and restores the open balance", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const setup = await setupOpenInvoice(agent, {
      subscription: { startDate: TODAY },
    });

    const payment = await recordPayment(agent, setup.invoice.id, {
      amountMinor: 2_900,
      method: "CARD",
    });
    expect(payment.status).toBe(201);
    const paymentId = (payment.body as PaymentActionResponse).payment.id;

    const refunded = await paymentAction(agent, paymentId, "refund");
    expect(refunded.status).toBe(200);

    const response = await getOverview(agent, {
      from: TODAY,
      to: TODAY,
      grouping: "day",
    });
    const body = response.body as AnalyticsOverviewResponse;
    const usd = body.currencies.find((row) => row.currency === "USD");

    expect(usd).toMatchObject({
      mrrMinor: 2_900,
      grossCollectedMinor: 2_900,
      refundedMinor: 2_900,
      netCollectedMinor: 0,
      outstandingMinor: 2_900,
      averageRevenuePerCustomerMinor: 0,
      customerLifetimeValueMinor: 0,
    });

    const invoices = await agent
      .get(API_PATHS.analyticsInvoices)
      .query({ from: TODAY, to: TODAY, grouping: "day" })
      .set("Origin", TEST_ORIGIN);
    const invoiceBody = invoices.body as AnalyticsInvoicesResponse;
    expect(invoiceBody.currencies[0]).toMatchObject({
      currency: "USD",
      invoicedMinor: 2_900,
      collectedMinor: 0,
      cashCollectedMinor: 2_900,
      refundedMinor: 2_900,
      outstandingMinor: 2_900,
      collectionRateBps: 0,
    });

    const revenue = await agent
      .get(API_PATHS.analyticsRevenue)
      .query({ from: TODAY, to: TODAY, grouping: "day" })
      .set("Origin", TEST_ORIGIN);
    const revenueBody = revenue.body as AnalyticsRevenueResponse;
    expect(revenueBody.totals[0]).toMatchObject({
      grossCollectedMinor: 2_900,
      refundedMinor: 2_900,
      netCollectedMinor: 0,
      outstandingMinor: 2_900,
    });
  });

  it("calculates churn, gross retention, net retention, and expansion MRR", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);

    const retained = await setupSubscription(agent, {
      subscription: { startDate: RANGE_FROM },
      customer: { name: "Retained Customer", email: "retained@example.test" },
      plan: { name: "Retention Plan" },
    });
    const churned = await setupSubscription(agent, {
      subscription: { startDate: RANGE_FROM },
      customer: { name: "Churned Customer", email: "churned@example.test" },
      plan: { name: "Retention Plan" },
    });

    const canceled = await agent
      .post(API_PATHS.subscriptionCancel(churned.subscription.id))
      .set("Origin", TEST_ORIGIN)
      .send({ atPeriodEnd: false });
    expect(canceled.status).toBe(200);

    await createSubscription(agent, {
      customerId: retained.customer.id,
      planId: retained.plan.id,
      startDate: TODAY,
    });

    const churn = await agent
      .get(API_PATHS.analyticsChurn)
      .query(rangeQuery())
      .set("Origin", TEST_ORIGIN);
    expect(churn.status).toBe(200);
    const churnBody = churn.body as AnalyticsChurnResponse;

    expect(churnBody.summary).toMatchObject({
      startingCustomers: 2,
      churnedCustomers: 1,
      customerChurnRateBps: 5_000,
      startingSubscriptions: 2,
      churnedSubscriptions: 1,
      subscriptionRetentionBps: 5_000,
    });
    expect(churnBody.summary.byCurrency).toEqual([
      {
        currency: "USD",
        startingMrrMinor: 5_800,
        churnedMrrMinor: 2_900,
        expansionMrrMinor: 2_900,
        revenueChurnRateBps: 5_000,
        grossRevenueRetentionBps: 5_000,
        netRevenueRetentionBps: 10_000,
      },
    ]);
    expect(churnBody.points.at(-1)).toMatchObject({
      newCustomers: 0,
      churnedCustomers: 1,
      newSubscriptions: 1,
      churnedSubscriptions: 1,
    });

    const growth = await agent
      .get(API_PATHS.analyticsSubscriptions)
      .query(rangeQuery())
      .set("Origin", TEST_ORIGIN);
    expect(growth.status).toBe(200);
    const growthBody = growth.body as AnalyticsSubscriptionGrowthResponse;
    expect(growthBody.summary).toMatchObject({
      newSubscriptions: 3,
      canceledSubscriptions: 1,
      netGrowth: 2,
      startingSubscriptions: 2,
      endingSubscriptions: 2,
      growthRateBps: 10_000,
      churnRateBps: 5_000,
    });
  });

  it("classifies new and returning customers and paginates detail endpoints", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const returning = await setupSubscription(agent, {
      subscription: { startDate: RANGE_FROM },
      customer: { name: "Returning Customer", email: "returning@example.test" },
      plan: { name: "Returning Plan" },
    });
    await createSubscription(agent, {
      customerId: returning.customer.id,
      planId: returning.plan.id,
      startDate: TODAY,
    });
    await setupSubscription(agent, {
      subscription: { startDate: TODAY },
      customer: { name: "New Customer", email: "new@example.test" },
      plan: { name: "New Plan" },
    });

    const customers = await agent
      .get(API_PATHS.analyticsCustomers)
      .query({
        from: TODAY,
        to: TODAY,
        grouping: "day",
        page: "1",
        pageSize: "1",
      })
      .set("Origin", TEST_ORIGIN);
    expect(customers.status).toBe(200);
    const customerBody = customers.body as AnalyticsCustomersResponse;

    expect(customerBody.summary).toMatchObject({
      totalCustomers: 2,
      activeCustomers: 2,
      newCustomers: 1,
      returningCustomers: 1,
      churnedCustomers: 0,
      customerChurnRateBps: 0,
    });
    expect(customerBody.topCustomers).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
      totalPages: 2,
    });
    expect(customerBody.topCustomers.items).toHaveLength(1);
    expect(customerBody.points).toEqual([
      expect.objectContaining({
        newCustomers: 1,
        returningCustomers: 1,
        churnedCustomers: 0,
        activeCustomers: 2,
      }),
    ]);

    const secondPage = await agent
      .get(API_PATHS.analyticsCustomers)
      .query({
        from: TODAY,
        to: TODAY,
        grouping: "day",
        page: "2",
        pageSize: "1",
      })
      .set("Origin", TEST_ORIGIN);
    const secondPageBody = secondPage.body as AnalyticsCustomersResponse;
    expect(secondPageBody.topCustomers.page).toBe(2);
    expect(secondPageBody.topCustomers.items).toHaveLength(1);
    expect(secondPageBody.topCustomers.items[0]?.customerId).not.toBe(
      customerBody.topCustomers.items[0]?.customerId,
    );

    const plans = await agent
      .get(API_PATHS.analyticsPlans)
      .query({
        from: RANGE_FROM,
        to: TODAY,
        grouping: "month",
        page: "1",
        pageSize: "1",
      })
      .set("Origin", TEST_ORIGIN);
    expect(plans.status).toBe(200);
    const planBody = plans.body as AnalyticsPlansResponse;
    expect(planBody.total).toBe(2);
    expect(planBody.totalPages).toBe(2);
    expect(planBody.items).toHaveLength(1);
    expect(planBody.items[0]?.currency).toBe("USD");
  });

  it("reports MRR history with normalized values by bucket", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);

    await setupSubscription(agent, {
      subscription: { startDate: RANGE_FROM },
      customer: { name: "History Customer", email: "history@example.test" },
      plan: {
        name: "Annual History",
        price: { amountMinor: 120_000, currency: "USD" },
        interval: "YEAR",
      },
    });

    const response = await agent
      .get(API_PATHS.analyticsMrr)
      .query(rangeQuery())
      .set("Origin", TEST_ORIGIN);
    expect(response.status).toBe(200);
    const body = response.body as AnalyticsMrrResponse;

    expect(body.points).toHaveLength(25);
    expect(body.latest).toEqual([
      {
        currency: "USD",
        mrrMinor: 10_000,
        arrMinor: 120_000,
        newMrrMinor: 0,
        churnedMrrMinor: 0,
        netNewMrrMinor: 0,
      },
    ]);
    expect(body.points[0]?.currencies[0]).toMatchObject({
      mrrMinor: 10_000,
      arrMinor: 120_000,
    });
  });

  it("isolates analytics and exports by organization", async () => {
    const { app } = createTestApp();
    const owner = await registerOwner(app);
    const setup = await setupOpenInvoice(owner.agent, {
      subscription: { startDate: TODAY },
      customer: { name: "Tenant A Customer", email: "tenant-a@example.test" },
      plan: { name: "Tenant A Plan" },
    });
    await recordPayment(owner.agent, setup.invoice.id, { amountMinor: 1_000 });

    const other = await registerBillingAccount(app, {
      name: "Bob Reed",
      email: "bob@example.com",
      organizationName: "Bob Workspace",
    });
    const otherSetup = await setupOpenInvoice(other.agent, {
      subscription: { startDate: TODAY },
      customer: { name: "Tenant B Customer", email: "tenant-b@example.test" },
      plan: {
        name: "Tenant B Plan",
        price: { amountMinor: 7_000, currency: "USD" },
      },
    });
    await recordPayment(other.agent, otherSetup.invoice.id, {
      amountMinor: 700,
    });

    const otherOverview = await getOverview(other.agent, {
      from: TODAY,
      to: TODAY,
      grouping: "day",
    });
    const otherBody = otherOverview.body as AnalyticsOverviewResponse;
    expect(otherBody.currencies).toHaveLength(1);
    expect(otherBody.currencies[0]?.netCollectedMinor).toBe(700);

    const otherRevenue = await other.agent
      .get(API_PATHS.analyticsRevenueCsv)
      .query({ from: TODAY, to: TODAY, grouping: "day" })
      .set("Origin", TEST_ORIGIN);
    expect(otherRevenue.status).toBe(200);
    expect(otherRevenue.text).not.toContain("Tenant A");
    expect(otherRevenue.text).not.toContain("29.00");
    expect(otherRevenue.text).toContain("7.00");

    const otherPlans = await other.agent
      .get(API_PATHS.analyticsPlans)
      .query({ from: TODAY, to: TODAY, grouping: "day" })
      .set("Origin", TEST_ORIGIN);
    const otherPlansBody = otherPlans.body as AnalyticsPlansResponse;
    expect(otherPlansBody.items).toHaveLength(1);
    expect(otherPlansBody.items[0]?.planName).toBe("Tenant B Plan");
  });

  it("exports date-scoped CSV reports with currency formatting", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const setup = await setupOpenInvoice(agent, {
      subscription: { startDate: TODAY },
      plan: { name: "Growth Plan" },
    });
    await recordPayment(agent, setup.invoice.id, { amountMinor: 1_000 });

    const revenue = await agent
      .get(API_PATHS.analyticsRevenueCsv)
      .query({ from: TODAY, to: TODAY, grouping: "day" })
      .set("Origin", TEST_ORIGIN);

    expect(revenue.status).toBe(200);
    expect(revenue.headers["content-type"]).toContain("text/csv");
    expect(revenue.headers["cache-control"]).toBe("no-store");
    expect(revenue.headers["content-disposition"]).toContain(
      `revenue-${TODAY}-to-${TODAY}.csv`,
    );
    expect(revenue.text.split("\r\n")[0]).toBe(
      "Period start,Period end,Period,Currency,Invoiced,Gross collected,Refunds,Net collected,Outstanding,New subscriptions,Canceled subscriptions",
    );
    const todayParts = new Date(`${TODAY}T00:00:00.000Z`);
    const monthLabel = new Intl.DateTimeFormat("en-US", {
      month: "short",
      timeZone: "UTC",
    }).format(todayParts);
    expect(revenue.text).toContain(
      `${TODAY}T00:00:00.000Z,${daysFromToday(1)}T00:00:00.000Z,${monthLabel} ${todayParts.getUTCDate()},USD,29.00,10.00,0.00,10.00,19.00,1,0`,
    );

    const subscriptions = await agent
      .get(API_PATHS.analyticsSubscriptionsCsv)
      .query({ from: TODAY, to: TODAY, grouping: "day" })
      .set("Origin", TEST_ORIGIN);

    expect(subscriptions.status).toBe(200);
    expect(subscriptions.headers["content-disposition"]).toContain(
      `subscriptions-${TODAY}-to-${TODAY}.csv`,
    );
    expect(subscriptions.text).toContain("Growth Plan");
    expect(subscriptions.text).toContain(
      "USD,1,1,0,29.00,348.00,10.00,19.00,",
    );
  });

  it("escapes spreadsheet formulas in CSV text fields", () => {
    const row: AnalyticsSubscriptionReportRow = {
      reportFrom: "2026-01-01",
      reportTo: "2026-01-31",
      planId: "plan-1",
      planName: "=SUM(A1:A2)",
      planCode: "+cmd|' /C calc'!A0",
      interval: "MONTH",
      currency: "USD",
      activeSubscriptions: 1,
      newSubscriptions: 1,
      canceledSubscriptions: 0,
      mrrMinor: 2_900,
      arrMinor: 34_800,
      netCollectedMinor: 2_900,
      outstandingMinor: 0,
      churnRateBps: null,
    };

    const csv = buildSubscriptionCsv([row]);
    expect(csv).toContain("'=SUM(A1:A2)");
    expect(csv).toContain("'+cmd|' /C calc'!A0");

    const whitespaceCsv = buildSubscriptionCsv([
      { ...row, planName: "  =HYPERLINK(\"https://example.test\")" },
    ]);
    expect(whitespaceCsv).toContain("'  =HYPERLINK");
  });

  it("rejects invalid filters and pages before touching analytics data", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);

    const invalidGrouping = await getOverview(agent, {
      from: TODAY,
      to: TODAY,
      grouping: "year",
    });
    expect(invalidGrouping.status).toBe(400);
    expect(
      (invalidGrouping.body as ApiErrorResponse).error.details?.some(
        (issue) => issue.path === "grouping",
      ),
    ).toBe(true);

    const reversed = await getOverview(agent, {
      from: TODAY,
      to: daysFromToday(-1),
    });
    expect(reversed.status).toBe(400);
    expect(
      (reversed.body as ApiErrorResponse).error.details?.some(
        (issue) => issue.path === "from",
      ),
    ).toBe(true);

    for (const pageSize of ["0", "101"]) {
      const invalidPage = await agent
        .get(API_PATHS.analyticsCustomers)
        .query({ from: TODAY, to: TODAY, pageSize })
        .set("Origin", TEST_ORIGIN);
      expect(invalidPage.status).toBe(400);
      expect(
        (invalidPage.body as ApiErrorResponse).error.details?.some(
          (issue) => issue.path === "pageSize",
        ),
      ).toBe(true);
    }

    const unknown = await getOverview(agent, {
      from: TODAY,
      to: TODAY,
      unexpected: "value",
    });
    expect(unknown.status).toBe(400);
  });
});
