import { randomUUID } from "node:crypto";
import type request from "supertest";
import { describe, expect, it } from "vitest";
import {
  API_PATHS,
  type ApiErrorResponse,
  type GenerateInvoiceResponse,
  type InvoiceListResponse,
  type InvoiceResponse,
  type PaymentActionResponse,
  type SubscriptionResponse,
} from "@subscript/shared";
import { TEST_ORIGIN, createTestApp } from "./helpers/test-app.js";
import {
  createCustomer,
  createPlan,
  createSubscription,
  recordPayment,
  registerBillingAccount,
  setupOpenInvoice,
  setupSubscription,
} from "./helpers/billing.js";

type Agent = ReturnType<typeof request.agent>;

async function registerOwner(app: ReturnType<typeof createTestApp>["app"]) {
  return registerBillingAccount(app, {
    name: "Alice Stone",
    email: "alice@example.com",
    organizationName: "Alice Workspace",
  });
}

function generate(
  agent: Agent,
  subscriptionId: string,
  payload: Record<string, unknown> = {},
) {
  return agent
    .post(API_PATHS.subscriptionInvoices(subscriptionId))
    .set("Origin", TEST_ORIGIN)
    .send({ taxRateBps: 0, dueInDays: 7, ...payload });
}

function invoiceAction(agent: Agent, invoiceId: string, action: string) {
  const path =
    action === "issue"
      ? API_PATHS.invoiceIssue(invoiceId)
      : action === "void"
        ? API_PATHS.invoiceVoid(invoiceId)
        : API_PATHS.invoiceMarkUncollectible(invoiceId);

  return agent.post(path).set("Origin", TEST_ORIGIN);
}

function paymentAction(agent: Agent, paymentId: string, action: string) {
  const path =
    action === "succeed"
      ? API_PATHS.paymentSucceed(paymentId)
      : action === "fail"
        ? API_PATHS.paymentFail(paymentId)
        : API_PATHS.paymentRefund(paymentId);

  return agent.post(path).set("Origin", TEST_ORIGIN);
}

describe("invoices", () => {
  it("generates a draft invoice with tax, a snapshot, and idempotency", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const setup = await setupSubscription(agent, {
      subscription: { startDate: "2026-01-31" },
      customer: {
        name: "Acme Industries",
        company: "Acme Holdings",
        email: "ap@acme.test",
      },
    });

    const generated = await generate(agent, setup.subscription.id, {
      taxRateBps: 825,
      dueInDays: 10,
    });

    expect(generated.status).toBe(201);
    const first = (generated.body as GenerateInvoiceResponse).invoice;

    expect((generated.body as GenerateInvoiceResponse).created).toBe(true);
    expect(generated.headers.location).toBe(API_PATHS.invoice(first.id));
    expect(first).toMatchObject({
      number: "INV-000001",
      status: "DRAFT",
      customerId: setup.customer.id,
      customerName: "Acme Industries",
      subscriptionId: setup.subscription.id,
      subtotal: { amountMinor: 2_900, currency: "USD" },
      tax: { amountMinor: 239, currency: "USD" },
      total: { amountMinor: 3_139, currency: "USD" },
      amountPaid: { amountMinor: 0, currency: "USD" },
      amountDue: { amountMinor: 3_139, currency: "USD" },
      taxRateBps: 825,
      periodStart: "2026-01-31T00:00:00.000Z",
      periodEnd: "2026-02-28T00:00:00.000Z",
      issuedAt: null,
      dueAt: null,
      paidAt: null,
    });
    expect(first.customer).toMatchObject({
      name: "Acme Industries",
      email: "ap@acme.test",
      company: "Acme Holdings",
      billingAddress: {
        line1: "1 Market Street",
        city: "San Francisco",
        country: "United States",
      },
    });
    expect(first.lineItems).toHaveLength(1);
    expect(first.lineItems[0]).toMatchObject({
      description: "Growth (2026-01-31 - 2026-02-28)",
      quantity: 1,
      unitAmountMinor: 2_900,
      totalMinor: 2_900,
    });
    expect(first.activities.map((activity) => activity.type)).toContain(
      "CREATED",
    );

    const duplicate = await generate(agent, setup.subscription.id, {
      taxRateBps: 825,
      dueInDays: 10,
    });
    expect(duplicate.status).toBe(200);
    expect((duplicate.body as GenerateInvoiceResponse).created).toBe(false);
    expect((duplicate.body as GenerateInvoiceResponse).invoice.id).toBe(
      first.id,
    );

    const list = await agent.get(API_PATHS.invoices);
    expect((list.body as InvoiceListResponse).total).toBe(1);
  });

  it("uses organization-scoped invoice numbers for each billing period", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const setup = await setupSubscription(agent, {
      subscription: { startDate: "2026-01-01" },
    });

    const first = await generate(agent, setup.subscription.id);
    expect(
      ((first.body as GenerateInvoiceResponse).invoice.number),
    ).toBe("INV-000001");

    const renewed = await agent
      .post(API_PATHS.subscriptionRenew(setup.subscription.id))
      .set("Origin", TEST_ORIGIN)
      .send({});
    expect(renewed.status).toBe(200);

    const second = await generate(agent, setup.subscription.id);
    expect(second.status).toBe(201);
    expect((second.body as GenerateInvoiceResponse).invoice.number).toBe(
      "INV-000002",
    );
    expect((second.body as GenerateInvoiceResponse).invoice.periodStart).toBe(
      "2026-02-01T00:00:00.000Z",
    );

    const other = await registerBillingAccount(app, {
      name: "Bob Reed",
      email: "bob@example.com",
      organizationName: "Bob Workspace",
    });
    const otherSetup = await setupSubscription(other.agent, {
      subscription: { startDate: "2026-01-01" },
      customer: { email: "bob-customer@example.com" },
    });
    const otherInvoice = await generate(other.agent, otherSetup.subscription.id);
    expect(
      (otherInvoice.body as GenerateInvoiceResponse).invoice.number,
    ).toBe("INV-000001");
  });

  it("issues, voids, and writes off invoices with guarded transitions", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const setup = await setupOpenInvoice(agent, {
      subscription: { startDate: "2026-01-01" },
    });

    expect(setup.invoice.status).toBe("OPEN");
    expect(setup.invoice.issuedAt).not.toBeNull();
    expect(setup.invoice.dueAt).not.toBeNull();
    expect(
      (await invoiceAction(agent, setup.invoice.id, "issue")).status,
    ).toBe(409);

    const voided = await invoiceAction(agent, setup.invoice.id, "void");
    expect(voided.status).toBe(200);
    expect((voided.body as InvoiceResponse).invoice.status).toBe("VOID");
    expect(
      (voided.body as InvoiceResponse).invoice.activities.map(
        (activity) => activity.type,
      ),
    ).toContain("VOIDED");
    expect(
      (await invoiceAction(agent, setup.invoice.id, "void")).status,
    ).toBe(409);

    const draftSetup = await setupSubscription(agent, {
      subscription: { startDate: "2026-03-01" },
      customer: { email: "draft@acme.test" },
      plan: { name: "Draft Plan" },
    });
    const draft = await generate(agent, draftSetup.subscription.id);
    const draftInvoice = (draft.body as GenerateInvoiceResponse).invoice;

    const writtenOff = await invoiceAction(
      agent,
      draftInvoice.id,
      "mark-uncollectible",
    );
    expect(writtenOff.status).toBe(200);
    expect((writtenOff.body as InvoiceResponse).invoice.status).toBe(
      "UNCOLLECTIBLE",
    );
    expect(
      (writtenOff.body as InvoiceResponse).invoice.activities.map(
        (activity) => activity.type,
      ),
    ).toContain("MARKED_UNCOLLECTIBLE");
    expect(
      (await invoiceAction(agent, draftInvoice.id, "issue")).status,
    ).toBe(409);
  });

  it("handles partial payments, overpayment, settlement, and refunds", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const setup = await setupOpenInvoice(agent, {
      subscription: { startDate: "2026-01-01" },
    });
    const invoiceId = setup.invoice.id;

    const partial = await recordPayment(agent, invoiceId, {
      amountMinor: 1_000,
      method: "CARD",
      reference: "card-123",
      note: "First installment",
    });
    expect(partial.status).toBe(201);
    const partialBody = partial.body as PaymentActionResponse;

    expect(partialBody.payment).toMatchObject({
      invoiceId,
      amount: { amountMinor: 1_000, currency: "USD" },
      method: "CARD",
      status: "SUCCEEDED",
      source: "MANUAL",
      reference: "card-123",
      note: "First installment",
    });
    expect(partialBody.payment.paidAt).not.toBeNull();
    expect(partialBody.invoice).toMatchObject({
      status: "OPEN",
      amountPaid: { amountMinor: 1_000 },
      amountDue: { amountMinor: 1_900 },
    });
    expect(
      partialBody.invoice.activities.some(
        (activity) => activity.type === "PAYMENT_SUCCEEDED",
      ),
    ).toBe(true);

    const overpayment = await recordPayment(agent, invoiceId, {
      amountMinor: 1_901,
    });
    expect(overpayment.status).toBe(409);

    const paid = await recordPayment(agent, invoiceId, {
      amountMinor: 1_900,
      method: "BANK_TRANSFER",
    });
    expect(paid.status).toBe(201);
    expect((paid.body as PaymentActionResponse).invoice).toMatchObject({
      status: "PAID",
      amountPaid: { amountMinor: 2_900 },
      amountDue: { amountMinor: 0 },
    });
    expect((paid.body as PaymentActionResponse).invoice.paidAt).not.toBeNull();
    expect(
      (
        await recordPayment(agent, invoiceId, { amountMinor: 1 })
      ).status,
    ).toBe(409);

    const paymentId = partialBody.payment.id;
    const refunded = await paymentAction(agent, paymentId, "refund");
    expect(refunded.status).toBe(200);
    expect((refunded.body as PaymentActionResponse).payment.status).toBe(
      "REFUNDED",
    );
    expect(
      (refunded.body as PaymentActionResponse).payment.refundedAt,
    ).not.toBeNull();
    expect((refunded.body as PaymentActionResponse).invoice).toMatchObject({
      status: "OPEN",
      amountPaid: { amountMinor: 1_900 },
      amountDue: { amountMinor: 1_000 },
    });
    expect(
      (await paymentAction(agent, paymentId, "refund")).status,
    ).toBe(409);

    const remaining = await recordPayment(agent, invoiceId, {
      amountMinor: 1_000,
    });
    expect(remaining.status).toBe(201);
    expect((remaining.body as PaymentActionResponse).invoice.status).toBe(
      "PAID",
    );

    const detail = await agent.get(API_PATHS.invoice(invoiceId));
    const invoice = (detail.body as InvoiceResponse).invoice;
    expect(invoice.payments).toHaveLength(3);
    expect(
      invoice.payments.map((payment) => payment.status).sort(),
    ).toEqual(["REFUNDED", "SUCCEEDED", "SUCCEEDED"]);

    const subscriptionDetail = await agent.get(
      API_PATHS.subscription(setup.subscription.id),
    );
    const subscriptionBody = subscriptionDetail.body as SubscriptionResponse;
    expect(subscriptionBody.payments).toHaveLength(3);
    expect(subscriptionBody.invoices).toHaveLength(1);
    expect(subscriptionBody.subscription.outstanding.amountMinor).toBe(0);
  });

  it("records pending attempts, failures, later confirmation, and multiple attempts", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const setup = await setupOpenInvoice(agent, {
      subscription: { startDate: "2026-01-01" },
    });
    const invoiceId = setup.invoice.id;

    const pending = await recordPayment(agent, invoiceId, {
      amountMinor: 500,
      status: "PENDING",
      method: "CHECK",
    });
    expect(pending.status).toBe(201);
    const pendingPayment = (pending.body as PaymentActionResponse).payment;
    expect(pendingPayment).toMatchObject({
      status: "PENDING",
      paidAt: null,
      source: "MANUAL",
    });
    expect(
      (pending.body as PaymentActionResponse).invoice.amountPaid.amountMinor,
    ).toBe(0);

    const failed = await paymentAction(agent, pendingPayment.id, "fail");
    expect(failed.status).toBe(200);
    expect((failed.body as PaymentActionResponse).payment.status).toBe(
      "FAILED",
    );
    expect(
      (failed.body as PaymentActionResponse).payment.failedAt,
    ).not.toBeNull();
    expect(
      (await paymentAction(agent, pendingPayment.id, "succeed")).status,
    ).toBe(409);

    const retry = await recordPayment(agent, invoiceId, {
      amountMinor: 1_200,
      status: "PENDING",
    });
    const retryPayment = (retry.body as PaymentActionResponse).payment;
    const confirmed = await paymentAction(agent, retryPayment.id, "succeed");
    expect(confirmed.status).toBe(200);
    expect((confirmed.body as PaymentActionResponse).invoice).toMatchObject({
      status: "OPEN",
      amountPaid: { amountMinor: 1_200 },
      amountDue: { amountMinor: 1_700 },
    });
    expect(
      (await paymentAction(agent, retryPayment.id, "succeed")).status,
    ).toBe(409);

    const finalPending = await recordPayment(agent, invoiceId, {
      amountMinor: 1_700,
      status: "PENDING",
    });
    const finalPayment = (finalPending.body as PaymentActionResponse).payment;
    const final = await paymentAction(agent, finalPayment.id, "succeed");
    expect(final.status).toBe(200);
    expect((final.body as PaymentActionResponse).invoice.status).toBe("PAID");
    expect(
      (await paymentAction(agent, finalPayment.id, "succeed")).status,
    ).toBe(409);
  });

  it("refuses payments on drafts and write-offs until an invoice is open", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const setup = await setupSubscription(agent, {
      subscription: { startDate: "2026-01-01" },
    });
    const generated = await generate(agent, setup.subscription.id);
    const invoiceId = (generated.body as GenerateInvoiceResponse).invoice.id;

    expect(
      (await recordPayment(agent, invoiceId, { amountMinor: 100 })).status,
    ).toBe(409);

    await invoiceAction(agent, invoiceId, "issue");
    const paid = await recordPayment(agent, invoiceId, {
      amountMinor: 2_900,
    });
    expect(paid.status).toBe(201);

    expect((await invoiceAction(agent, invoiceId, "void")).status).toBe(409);
    expect(
      (await invoiceAction(agent, invoiceId, "mark-uncollectible")).status,
    ).toBe(409);
  });

  it("handles zero-decimal currencies, quantities, and historical pricing", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const customerResponse = await createCustomer(agent);
    const planResponse = await createPlan(agent, {
      name: "Tokyo",
      price: { amountMinor: 5_000, currency: "JPY" },
      interval: "MONTH",
    });
    const customer = (
      customerResponse.body as { customer: { id: string } }
    ).customer;
    const plan = (planResponse.body as { plan: { id: string } }).plan;
    const created = await createSubscription(agent, {
      customerId: customer.id,
      planId: plan.id,
      startDate: "2026-01-01",
      quantity: 3,
    });
    const subscription = (
      created.body as { subscription: { id: string } }
    ).subscription;

    await agent
      .patch(API_PATHS.plan(plan.id))
      .set("Origin", TEST_ORIGIN)
      .send({ price: { amountMinor: 9_900, currency: "JPY" } });

    const invoiceResponse = await generate(agent, subscription.id, {
      taxRateBps: 1_000,
      dueInDays: 0,
    });
    const invoice = (invoiceResponse.body as GenerateInvoiceResponse).invoice;

    expect(invoice).toMatchObject({
      subtotal: { amountMinor: 15_000, currency: "JPY" },
      tax: { amountMinor: 1_500, currency: "JPY" },
      total: { amountMinor: 16_500, currency: "JPY" },
      taxRateBps: 1_000,
    });
    expect(invoice.lineItems[0]).toMatchObject({
      quantity: 3,
      unitAmountMinor: 5_000,
      totalMinor: 15_000,
    });

    const issued = await invoiceAction(agent, invoice.id, "issue");
    expect(issued.status).toBe(200);
    expect((issued.body as InvoiceResponse).invoice.dueAt).not.toBeNull();
  });

  it("lists invoices with status, customer, subscription, search, and paging filters", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const first = await setupOpenInvoice(agent, {
      subscription: { startDate: "2026-01-01" },
      customer: { name: "Alpha Co", email: "alpha@example.com" },
    });
    const second = await setupSubscription(agent, {
      subscription: { startDate: "2026-02-01" },
      customer: { name: "Beta Co", email: "beta@example.com" },
      plan: { name: "Beta Plan", price: { amountMinor: 4_900, currency: "USD" } },
    });
    const draftResponse = await generate(agent, second.subscription.id);
    const draft = (draftResponse.body as GenerateInvoiceResponse).invoice;

    const open = await agent.get(`${API_PATHS.invoices}?status=OPEN`);
    expect((open.body as InvoiceListResponse).total).toBe(1);
    expect((open.body as InvoiceListResponse).invoices[0]?.id).toBe(
      first.invoice.id,
    );

    const drafts = await agent.get(`${API_PATHS.invoices}?status=DRAFT`);
    expect((drafts.body as InvoiceListResponse).total).toBe(1);
    expect((drafts.body as InvoiceListResponse).invoices[0]?.id).toBe(draft.id);

    const byCustomer = await agent.get(
      `${API_PATHS.invoices}?customerId=${first.customer.id}`,
    );
    expect((byCustomer.body as InvoiceListResponse).total).toBe(1);

    const bySubscription = await agent.get(
      `${API_PATHS.invoices}?subscriptionId=${second.subscription.id}`,
    );
    expect((bySubscription.body as InvoiceListResponse).total).toBe(1);
    expect(
      (bySubscription.body as InvoiceListResponse).invoices[0]?.number,
    ).toBe("INV-000002");

    const search = await agent.get(`${API_PATHS.invoices}?query=alpha`);
    expect((search.body as InvoiceListResponse).total).toBe(1);
    expect((search.body as InvoiceListResponse).invoices[0]?.customerName).toBe(
      "Alpha Co",
    );

    const paged = await agent.get(
      `${API_PATHS.invoices}?status=ALL&page=2&pageSize=1`,
    );
    expect((paged.body as InvoiceListResponse).page).toBe(2);
    expect((paged.body as InvoiceListResponse).totalPages).toBe(2);

    expect(
      (await agent.get(`${API_PATHS.invoices}?customerId=not-a-uuid`)).status,
    ).toBe(400);
  });

  it("blocks invoice generation for paused, canceled, and expired subscriptions", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const pausedSetup = await setupSubscription(agent, {
      subscription: { startDate: "2026-01-01" },
    });
    await agent
      .post(API_PATHS.subscriptionPause(pausedSetup.subscription.id))
      .set("Origin", TEST_ORIGIN)
      .send({});
    expect(
      (await generate(agent, pausedSetup.subscription.id)).status,
    ).toBe(409);

    const expiredSetup = await setupSubscription(agent, {
      subscription: { startDate: "2026-01-01" },
      customer: { email: "expired@acme.test" },
      plan: { name: "Expired Plan" },
    });
    await agent
      .post(API_PATHS.subscriptionExpire(expiredSetup.subscription.id))
      .set("Origin", TEST_ORIGIN)
      .send({});
    expect(
      (await generate(agent, expiredSetup.subscription.id)).status,
    ).toBe(409);
  });

  it("enforces member roles and organization isolation", async () => {
    const { app, store } = createTestApp();
    const alice = await registerOwner(app);
    const setup = await setupOpenInvoice(alice.agent, {
      subscription: { startDate: "2026-01-01" },
    });
    const pending = await recordPayment(alice.agent, setup.invoice.id, {
      amountMinor: 100,
      status: "PENDING",
    });
    const pendingPayment = (pending.body as PaymentActionResponse).payment;
    const bob = await registerBillingAccount(app, {
      name: "Bob Reed",
      email: "bob@example.com",
      organizationName: "Bob Workspace",
    });

    store.addMember(alice.account.organizationId, bob.account.id, "MEMBER");
    await bob.agent
      .post(API_PATHS.switchOrganization(alice.account.organizationId))
      .set("Origin", TEST_ORIGIN);

    expect((await bob.agent.get(API_PATHS.invoices)).status).toBe(200);
    expect(
      (await bob.agent.get(API_PATHS.invoice(setup.invoice.id))).status,
    ).toBe(200);
    expect(
      (
        await bob.agent
          .post(API_PATHS.invoiceIssue(setup.invoice.id))
          .set("Origin", TEST_ORIGIN)
      ).status,
    ).toBe(403);
    expect(
      (
        await bob.agent
          .post(API_PATHS.invoicePayments(setup.invoice.id))
          .set("Origin", TEST_ORIGIN)
          .send({ amountMinor: 100, method: "CASH" })
      ).status,
    ).toBe(403);
    expect(
      (await paymentAction(bob.agent, pendingPayment.id, "succeed")).status,
    ).toBe(403);

    store.addMember(alice.account.organizationId, bob.account.id, "ADMIN");
    expect(
      (
        await bob.agent
          .post(API_PATHS.invoicePayments(setup.invoice.id))
          .set("Origin", TEST_ORIGIN)
          .send({ amountMinor: 100, method: "CASH" })
      ).status,
    ).toBe(201);

    const outsider = await registerBillingAccount(app, {
      name: "Mallory",
      email: "mallory@example.com",
      organizationName: "Mallory Workspace",
    });

    expect(
      (await outsider.agent.get(API_PATHS.invoice(setup.invoice.id))).status,
    ).toBe(404);
    expect(
      (
        await outsider.agent
          .post(API_PATHS.invoiceIssue(setup.invoice.id))
          .set("Origin", TEST_ORIGIN)
      ).status,
    ).toBe(404);
    expect(
      (await paymentAction(outsider.agent, pendingPayment.id, "succeed"))
        .status,
    ).toBe(404);
    expect(
      (
        await outsider.agent
          .post(API_PATHS.invoicePayments(setup.invoice.id))
          .set("Origin", TEST_ORIGIN)
          .send({ amountMinor: 100, method: "CASH" })
      ).status,
    ).toBe(404);
    expect(
      (await outsider.agent.get(`${API_PATHS.invoices}?status=ALL`)).body
        .total,
    ).toBe(0);
  });

  it("prevents duplicate invoices and overpayments under concurrent requests", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const setup = await setupSubscription(agent, {
      subscription: { startDate: "2026-01-01" },
    });

    const generated = await Promise.all(
      Array.from({ length: 5 }, () => generate(agent, setup.subscription.id)),
    );
    const created = generated.filter((response) => response.status === 201);
    const existing = generated.filter((response) => response.status === 200);

    expect(created).toHaveLength(1);
    expect(existing).toHaveLength(4);
    const invoiceIds = new Set(
      generated.map(
        (response) => (response.body as GenerateInvoiceResponse).invoice.id,
      ),
    );
    expect(invoiceIds.size).toBe(1);

    const invoiceId = (created[0]?.body as GenerateInvoiceResponse).invoice.id;
    await invoiceAction(agent, invoiceId, "issue");

    const payments = await Promise.all([
      recordPayment(agent, invoiceId, { amountMinor: 2_000 }),
      recordPayment(agent, invoiceId, { amountMinor: 2_000 }),
    ]);
    expect(payments.filter((response) => response.status === 201)).toHaveLength(1);
    expect(payments.filter((response) => response.status === 409)).toHaveLength(1);

    const detail = await agent.get(API_PATHS.invoice(invoiceId));
    const invoice = (detail.body as InvoiceResponse).invoice;

    expect(invoice.amountPaid.amountMinor).toBe(2_000);
    expect(invoice.amountDue.amountMinor).toBe(900);
    expect(invoice.status).toBe("OPEN");

    const settle = await recordPayment(agent, invoiceId, { amountMinor: 900 });
    expect(settle.status).toBe(201);
    expect((settle.body as PaymentActionResponse).invoice.status).toBe("PAID");
  });

  it("prevents two pending payments from overdrawing an invoice", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const setup = await setupOpenInvoice(agent, {
      subscription: { startDate: "2026-01-01" },
    });
    const invoiceId = setup.invoice.id;
    const first = await recordPayment(agent, invoiceId, {
      amountMinor: 2_000,
      status: "PENDING",
    });
    const second = await recordPayment(agent, invoiceId, {
      amountMinor: 2_000,
      status: "PENDING",
    });
    const firstPayment = (first.body as PaymentActionResponse).payment;
    const secondPayment = (second.body as PaymentActionResponse).payment;

    const confirmations = await Promise.all([
      paymentAction(agent, firstPayment.id, "succeed"),
      paymentAction(agent, secondPayment.id, "succeed"),
    ]);

    expect(confirmations.filter((response) => response.status === 200)).toHaveLength(
      1,
    );
    expect(confirmations.filter((response) => response.status === 409)).toHaveLength(
      1,
    );

    const detail = await agent.get(API_PATHS.invoice(invoiceId));
    expect((detail.body as InvoiceResponse).invoice.amountPaid.amountMinor).toBe(
      2_000,
    );
  });

  it("returns 400 for malformed ids and 404 for unknown invoices and payments", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);

    expect((await agent.get("/api/invoices/not-a-uuid")).status).toBe(400);
    expect(
      (await agent.get(`/api/invoices/${randomUUID()}`)).status,
    ).toBe(404);
    expect(
      (
        await agent
          .post(`/api/payments/${randomUUID()}/succeed`)
          .set("Origin", TEST_ORIGIN)
      ).status,
    ).toBe(404);
    expect(
      (
        await agent
          .post(`/api/invoices/${randomUUID()}/payments`)
          .set("Origin", TEST_ORIGIN)
          .send({ amountMinor: 10, method: "CASH" })
      ).status,
    ).toBe(404);

    const invalid = await agent
      .post(`/api/invoices/${randomUUID()}/payments`)
      .set("Origin", TEST_ORIGIN)
      .send({ amountMinor: 0, method: "CASH" });
    expect(invalid.status).toBe(400);
    expect((invalid.body as ApiErrorResponse).error.code).toBe(
      "VALIDATION_ERROR",
    );
  });
});
