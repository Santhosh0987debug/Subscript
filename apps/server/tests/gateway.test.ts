import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  API_PATHS,
  type ApiErrorResponse,
  type GatewayCheckoutSession,
  type GatewayConfigResponse,
  type GatewayRefundResponse,
  type InvoiceResponse,
  type PaymentActionResponse,
} from "@subscript/shared";
import { recordPayment, registerBillingAccount, setupOpenInvoice } from "./helpers/billing.js";
import {
  createRazorpayMock,
  RAZORPAY_TEST_KEY_ID,
  RAZORPAY_TEST_KEY_SECRET,
  type RazorpayMock,
  type WebhookDelivery,
} from "./helpers/razorpay-mock.js";
import { createTestApp, TEST_ORIGIN } from "./helpers/test-app.js";

type Agent = ReturnType<typeof request.agent>;
type GatewayFixture = Awaited<ReturnType<typeof setupGatewayInvoice>>;

async function setupGatewayInvoice(options: {
  appOptions?: Parameters<typeof createTestApp>[0];
  mock?: RazorpayMock;
} = {}) {
  const mock = options.mock ?? createRazorpayMock();
  const test = createTestApp({
    ...options.appOptions,
    gateway: mock.gateway,
  });
  const account = await registerBillingAccount(test.app, {
    name: "Alice Stone",
    email: "alice@example.com",
    organizationName: "Alice Workspace",
  });
  const setup = await setupOpenInvoice(account.agent, {
    subscription: { startDate: "2026-01-01" },
  });

  return { ...test, mock, account, setup };
}

function startCheckout(agent: Agent, invoiceId: string) {
  return agent
    .post(API_PATHS.invoiceCheckout(invoiceId))
    .set("Origin", TEST_ORIGIN);
}

function verifyCheckout(
  agent: Agent,
  paymentId: string,
  input: {
    orderId: string;
    gatewayPaymentId: string;
    signature: string;
  },
) {
  return agent
    .post(API_PATHS.paymentGatewayVerify(paymentId))
    .set("Origin", TEST_ORIGIN)
    .send(input);
}

function cancelCheckout(
  agent: Agent,
  paymentId: string,
  orderId?: string | null,
) {
  return agent
    .post(API_PATHS.paymentGatewayCancel(paymentId))
    .set("Origin", TEST_ORIGIN)
    .send(orderId ? { orderId } : {});
}

function refundGatewayPayment(
  agent: Agent,
  paymentId: string,
  input: { amountMinor?: number; reason?: string | null } = {},
) {
  return agent
    .post(API_PATHS.paymentGatewayRefund(paymentId))
    .set("Origin", TEST_ORIGIN)
    .send(input);
}

function rawBodySerializer(data: unknown): string {
  return Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
}

function postWebhook(
  app: Express,
  delivery: WebhookDelivery,
  options: { eventId?: string | null; signature?: string | null } = {},
) {
  const requestBuilder = request(app)
    .post(API_PATHS.razorpayWebhook)
    .set("Content-Type", "application/json");
  const eventId =
    options.eventId === undefined ? delivery.eventId : options.eventId;
  const signature =
    options.signature === undefined ? delivery.signature : options.signature;

  if (eventId !== null) {
    requestBuilder.set("x-razorpay-event-id", eventId);
  }

  if (signature !== null) {
    requestBuilder.set("x-razorpay-signature", signature);
  }

  return requestBuilder.serialize(rawBodySerializer).send(delivery.rawBody);
}

async function invoiceFor(agent: Agent, invoiceId: string) {
  const response = await agent.get(API_PATHS.invoice(invoiceId));

  if (response.status !== 200) {
    throw new Error(
      `Invoice fetch failed: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }

  return (response.body as InvoiceResponse).invoice;
}

async function capturedCheckout(
  test: GatewayFixture,
  setup: GatewayFixture["setup"],
) {
  const started = await startCheckout(test.account.agent, setup.invoice.id);

  if (started.status !== 201) {
    throw new Error(
      `Checkout failed: ${started.status} ${JSON.stringify(started.body)}`,
    );
  }

  const session = started.body as GatewayCheckoutSession;
  const providerPayment = test.mock.addPayment({ orderId: session.orderId });
  const verified = await verifyCheckout(
    test.account.agent,
    session.payment.id,
    {
      orderId: session.orderId,
      gatewayPaymentId: providerPayment.id,
      signature: test.mock.checkoutSignature(
        session.orderId,
        providerPayment.id,
      ),
    },
  );

  if (verified.status !== 200) {
    throw new Error(
      `Verification failed: ${verified.status} ${JSON.stringify(verified.body)}`,
    );
  }

  return {
    session,
    payment: (verified.body as PaymentActionResponse).payment,
    invoice: (verified.body as PaymentActionResponse).invoice,
    providerPayment,
  };
}

describe("payment gateway configuration", () => {
  it("reports a disabled gateway and refuses checkout without provider credentials", async () => {
    const test = createTestApp();
    const account = await registerBillingAccount(test.app, {
      name: "Alice Stone",
      email: "alice@example.com",
      organizationName: "Alice Workspace",
    });
    const setup = await setupOpenInvoice(account.agent, {
      subscription: { startDate: "2026-01-01" },
    });

    const config = await account.agent.get(API_PATHS.gatewayConfig);
    expect(config.status).toBe(200);
    expect(config.body as GatewayConfigResponse).toEqual({
      provider: "razorpay",
      enabled: false,
      testMode: true,
    });
    expect(config.headers["cache-control"]).toBe("no-store");

    const checkout = await startCheckout(account.agent, setup.invoice.id);
    expect(checkout.status).toBe(503);
    expect((checkout.body as ApiErrorResponse).error.code).toBe(
      "SERVICE_UNAVAILABLE",
    );

    const invoice = await invoiceFor(account.agent, setup.invoice.id);
    expect(invoice.payments).toHaveLength(0);
    expect(invoice.amountPaid.amountMinor).toBe(0);
  });

  it("reports test mode and never exposes the provider secret", async () => {
    const test = await setupGatewayInvoice();
    const config = await test.account.agent.get(API_PATHS.gatewayConfig);

    expect(config.body as GatewayConfigResponse).toEqual({
      provider: "razorpay",
      enabled: true,
      testMode: true,
    });

    const checkout = await startCheckout(
      test.account.agent,
      test.setup.invoice.id,
    );
    expect(checkout.status).toBe(201);
    expect(JSON.stringify(checkout.body)).not.toContain(
      RAZORPAY_TEST_KEY_SECRET,
    );
    expect((checkout.body as GatewayCheckoutSession).keyId).toBe(
      RAZORPAY_TEST_KEY_ID,
    );
  });
});

describe("gateway checkout", () => {
  it("derives the order amount and currency from the invoice and blocks duplicate attempts", async () => {
    const test = await setupGatewayInvoice();
    const started = await startCheckout(
      test.account.agent,
      test.setup.invoice.id,
    );

    expect(started.status).toBe(201);
    const session = started.body as GatewayCheckoutSession;

    expect(session).toMatchObject({
      provider: "razorpay",
      keyId: RAZORPAY_TEST_KEY_ID,
      invoiceNumber: "INV-000001",
      amount: { amountMinor: 2_900, currency: "USD" },
      customerName: "Acme Industries",
      customerEmail: "billing@acme.test",
      testMode: true,
    });
    expect(session.payment).toMatchObject({
      invoiceId: test.setup.invoice.id,
      amount: { amountMinor: 2_900, currency: "USD" },
      method: "CARD",
      source: "GATEWAY",
      status: "PENDING",
      gateway: {
        provider: "razorpay",
        orderId: session.orderId,
        paymentId: null,
      },
    });

    expect(test.mock.orders.get(session.orderId)).toMatchObject({
      amount: 2_900,
      currency: "USD",
      receipt: "INV-000001",
      notes: {
        invoiceId: test.setup.invoice.id,
        paymentId: session.payment.id,
      },
    });
    expect(test.mock.requests[0]).toMatchObject({
      method: "POST",
      path: "/orders",
      authorization: `Basic ${Buffer.from(
        `${RAZORPAY_TEST_KEY_ID}:${RAZORPAY_TEST_KEY_SECRET}`,
      ).toString("base64")}`,
    });
    expect(test.mock.requests[0]?.body).toMatchObject({
      amount: 2_900,
      currency: "USD",
    });

    const invoice = await invoiceFor(
      test.account.agent,
      test.setup.invoice.id,
    );
    expect(invoice.amountPaid.amountMinor).toBe(0);
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0]?.status).toBe("PENDING");

    const duplicate = await startCheckout(
      test.account.agent,
      test.setup.invoice.id,
    );
    expect(duplicate.status).toBe(409);
    expect((duplicate.body as ApiErrorResponse).error.code).toBe("CONFLICT");
    expect(test.mock.orders.size).toBe(1);
    expect(
      (await invoiceFor(test.account.agent, test.setup.invoice.id)).payments,
    ).toHaveLength(1);
  });

  it("only allows owners and admins, and keeps tenant boundaries on gateway actions", async () => {
    const test = await setupGatewayInvoice();
    const started = await startCheckout(
      test.account.agent,
      test.setup.invoice.id,
    );
    const session = started.body as GatewayCheckoutSession;
    const member = await registerBillingAccount(test.app, {
      name: "Bob Reed",
      email: "bob@example.com",
      organizationName: "Bob Workspace",
    });

    test.store.addMember(
      test.account.account.organizationId,
      member.account.id,
      "MEMBER",
    );
    await member.agent
      .post(API_PATHS.switchOrganization(test.account.account.organizationId))
      .set("Origin", TEST_ORIGIN);

    expect(
      (await startCheckout(member.agent, test.setup.invoice.id)).status,
    ).toBe(403);
    expect(
      (
        await refundGatewayPayment(member.agent, session.payment.id, {
          amountMinor: 100,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await verifyCheckout(member.agent, session.payment.id, {
          orderId: session.orderId,
          gatewayPaymentId: "pay_not_used",
          signature: "0".repeat(64),
        })
      ).status,
    ).toBe(403);

    const outsider = await registerBillingAccount(test.app, {
      name: "Mallory",
      email: "mallory@example.com",
      organizationName: "Mallory Workspace",
    });

    expect(
      (await startCheckout(outsider.agent, test.setup.invoice.id)).status,
    ).toBe(404);
    expect(
      (
        await verifyCheckout(outsider.agent, session.payment.id, {
          orderId: session.orderId,
          gatewayPaymentId: "pay_not_used",
          signature: "0".repeat(64),
        })
      ).status,
    ).toBe(404);
    expect(
      (await cancelCheckout(outsider.agent, session.payment.id)).status,
    ).toBe(404);
    expect(
      (
        await refundGatewayPayment(outsider.agent, session.payment.id, {
          amountMinor: 100,
        })
      ).status,
    ).toBe(404);
  });
});

describe("gateway checkout verification", () => {
  it("rejects invalid signatures and mismatched provider payments without changing the balance", async () => {
    const test = await setupGatewayInvoice();
    const started = await startCheckout(
      test.account.agent,
      test.setup.invoice.id,
    );
    const session = started.body as GatewayCheckoutSession;
    const providerPayment = test.mock.addPayment({ orderId: session.orderId });

    const invalid = await verifyCheckout(
      test.account.agent,
      session.payment.id,
      {
        orderId: session.orderId,
        gatewayPaymentId: providerPayment.id,
        signature: "0".repeat(64),
      },
    );
    expect(invalid.status).toBe(400);
    expect((invalid.body as ApiErrorResponse).error.code).toBe("BAD_REQUEST");

    let invoice = await invoiceFor(test.account.agent, test.setup.invoice.id);
    expect(invoice.amountPaid.amountMinor).toBe(0);
    expect(invoice.payments[0]?.status).toBe("PENDING");

    const wrongAmount = test.mock.addPayment({
      orderId: session.orderId,
      amountMinor: 100,
    });
    const mismatch = await verifyCheckout(
      test.account.agent,
      session.payment.id,
      {
        orderId: session.orderId,
        gatewayPaymentId: wrongAmount.id,
        signature: test.mock.checkoutSignature(
          session.orderId,
          wrongAmount.id,
        ),
      },
    );
    expect(mismatch.status).toBe(400);

    const wrongOrder = await verifyCheckout(
      test.account.agent,
      session.payment.id,
      {
        orderId: "order_somewhere_else",
        gatewayPaymentId: providerPayment.id,
        signature: test.mock.checkoutSignature(
          "order_somewhere_else",
          providerPayment.id,
        ),
      },
    );
    expect(wrongOrder.status).toBe(409);

    invoice = await invoiceFor(test.account.agent, test.setup.invoice.id);
    expect(invoice.amountPaid.amountMinor).toBe(0);
    expect(invoice.payments[0]?.status).toBe("PENDING");
  });

  it("applies a captured payment once and treats repeated verification as idempotent", async () => {
    const test = await setupGatewayInvoice();
    const captured = await capturedCheckout(test, test.setup);

    expect(captured.payment).toMatchObject({
      status: "SUCCEEDED",
      source: "GATEWAY",
      gateway: {
        provider: "razorpay",
        orderId: captured.session.orderId,
        paymentId: captured.providerPayment.id,
        status: "captured",
      },
    });
    expect(captured.invoice).toMatchObject({
      status: "PAID",
      amountPaid: { amountMinor: 2_900, currency: "USD" },
      amountDue: { amountMinor: 0, currency: "USD" },
    });
    expect(
      captured.invoice.activities.some(
        (activity) => activity.type === "PAYMENT_SUCCEEDED",
      ),
    ).toBe(true);

    const repeat = await verifyCheckout(
      test.account.agent,
      captured.session.payment.id,
      {
        orderId: captured.session.orderId,
        gatewayPaymentId: captured.providerPayment.id,
        signature: test.mock.checkoutSignature(
          captured.session.orderId,
          captured.providerPayment.id,
        ),
      },
    );
    expect(repeat.status).toBe(200);
    expect((repeat.body as PaymentActionResponse).invoice.amountPaid.amountMinor).toBe(
      2_900,
    );

    const invoice = await invoiceFor(test.account.agent, test.setup.invoice.id);
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.amountPaid.amountMinor).toBe(2_900);
  });

  it("releases a cancelled checkout, allows a new attempt, and still accepts a later capture", async () => {
    const test = await setupGatewayInvoice();
    const started = await startCheckout(
      test.account.agent,
      test.setup.invoice.id,
    );
    const original = started.body as GatewayCheckoutSession;

    const cancelled = await cancelCheckout(
      test.account.agent,
      original.payment.id,
      original.orderId,
    );
    expect(cancelled.status).toBe(200);
    expect((cancelled.body as PaymentActionResponse).payment.status).toBe(
      "FAILED",
    );
    expect(
      (cancelled.body as PaymentActionResponse).invoice.amountPaid.amountMinor,
    ).toBe(0);

    const repeated = await cancelCheckout(
      test.account.agent,
      original.payment.id,
      original.orderId,
    );
    expect(repeated.status).toBe(200);
    expect((repeated.body as PaymentActionResponse).payment.status).toBe(
      "FAILED",
    );

    const retry = await startCheckout(
      test.account.agent,
      test.setup.invoice.id,
    );
    expect(retry.status).toBe(201);
    const pendingRetry = retry.body as GatewayCheckoutSession;
    expect((await cancelCheckout(test.account.agent, pendingRetry.payment.id)).status).toBe(
      200,
    );

    const providerPayment = test.mock.addPayment({
      orderId: original.orderId,
    });
    const recovered = await verifyCheckout(
      test.account.agent,
      original.payment.id,
      {
        orderId: original.orderId,
        gatewayPaymentId: providerPayment.id,
        signature: test.mock.checkoutSignature(
          original.orderId,
          providerPayment.id,
        ),
      },
    );
    expect(recovered.status).toBe(200);
    expect((recovered.body as PaymentActionResponse).payment.status).toBe(
      "SUCCEEDED",
    );
    expect((recovered.body as PaymentActionResponse).invoice.status).toBe(
      "PAID",
    );
  });
});

describe("razorpay webhooks", () => {
  it("requires a valid raw-body signature and event id", async () => {
    const test = await setupGatewayInvoice();
    const started = await startCheckout(
      test.account.agent,
      test.setup.invoice.id,
    );
    const session = started.body as GatewayCheckoutSession;
    const delivery = test.mock.paymentEvent({
      eventType: "payment.captured",
      orderId: session.orderId,
      paymentId: "pay_webhook_1",
      amountMinor: 2_900,
      currency: "USD",
    });

    expect(
      (await postWebhook(test.app, delivery, { signature: "0".repeat(64) }))
        .status,
    ).toBe(400);
    expect(
      (await postWebhook(test.app, delivery, { signature: null })).status,
    ).toBe(400);
    expect(
      (await postWebhook(test.app, delivery, { eventId: null })).status,
    ).toBe(400);

    const invalidJson = Buffer.from("{not-json", "utf8");
    const invalidDelivery: WebhookDelivery = {
      eventId: "evt_invalid_json",
      rawBody: invalidJson,
      signature: test.mock.signWebhook(invalidJson),
    };
    const invalidBody = await request(test.app)
      .post(API_PATHS.razorpayWebhook)
      .set("Content-Type", "application/json")
      .set("x-razorpay-event-id", invalidDelivery.eventId)
      .set("x-razorpay-signature", invalidDelivery.signature)
      .serialize(rawBodySerializer)
      .send(invalidJson);
    expect(invalidBody.status).toBe(400);

    const invoice = await invoiceFor(test.account.agent, test.setup.invoice.id);
    expect(invoice.amountPaid.amountMinor).toBe(0);
  });

  it("processes a capture once, deduplicates by provider event id, and preserves later state", async () => {
    const test = await setupGatewayInvoice();
    const started = await startCheckout(
      test.account.agent,
      test.setup.invoice.id,
    );
    const session = started.body as GatewayCheckoutSession;
    const delivery = test.mock.paymentEvent({
      eventType: "payment.captured",
      orderId: session.orderId,
      paymentId: "pay_webhook_2",
      amountMinor: 2_900,
      currency: "USD",
    });

    const first = await postWebhook(test.app, delivery);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ status: "processed" });

    const duplicate = await postWebhook(test.app, delivery);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toEqual({ status: "duplicate" });

    const invoice = await invoiceFor(test.account.agent, test.setup.invoice.id);
    expect(invoice.status).toBe("PAID");
    expect(invoice.amountPaid.amountMinor).toBe(2_900);
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0]?.status).toBe("SUCCEEDED");
    expect(invoice.payments[0]?.gateway?.paymentId).toBe("pay_webhook_2");

    const staleFailure = test.mock.paymentEvent({
      eventType: "payment.failed",
      orderId: session.orderId,
      paymentId: "pay_webhook_2",
      amountMinor: 2_900,
      currency: "USD",
      status: "failed",
    });
    const staleResponse = await postWebhook(test.app, staleFailure);
    expect(staleResponse.status).toBe(200);
    expect(staleResponse.body).toEqual({ status: "ignored" });

    const finalInvoice = await invoiceFor(
      test.account.agent,
      test.setup.invoice.id,
    );
    expect(finalInvoice.status).toBe("PAID");
    expect(finalInvoice.amountPaid.amountMinor).toBe(2_900);
    expect(finalInvoice.payments[0]?.status).toBe("SUCCEEDED");
  });

  it("ignores mismatched amounts, currencies, and orders without changing the balance", async () => {
    const test = await setupGatewayInvoice();
    const started = await startCheckout(
      test.account.agent,
      test.setup.invoice.id,
    );
    const session = started.body as GatewayCheckoutSession;

    for (const input of [
      {
        amountMinor: 100,
        currency: "USD",
        orderId: session.orderId,
        paymentId: "pay_wrong_amount",
      },
      {
        amountMinor: 2_900,
        currency: "EUR",
        orderId: session.orderId,
        paymentId: "pay_wrong_currency",
      },
      {
        amountMinor: 2_900,
        currency: "USD",
        orderId: "order_wrong",
        paymentId: "pay_wrong_order",
        internalPaymentId: session.payment.id,
      },
    ]) {
      const response = await postWebhook(
        test.app,
        test.mock.paymentEvent({
          eventType: "payment.captured",
          status: "captured",
          ...input,
        }),
      );
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "ignored" });
    }

    const invoice = await invoiceFor(test.account.agent, test.setup.invoice.id);
    expect(invoice.amountPaid.amountMinor).toBe(0);
    expect(invoice.payments[0]?.status).toBe("PENDING");
  });

  it("handles payment.failed before capture and ignores a late failure", async () => {
    const test = await setupGatewayInvoice();
    const started = await startCheckout(
      test.account.agent,
      test.setup.invoice.id,
    );
    const session = started.body as GatewayCheckoutSession;

    const failed = await postWebhook(
      test.app,
      test.mock.paymentEvent({
        eventType: "payment.failed",
        orderId: session.orderId,
        paymentId: "pay_retry_1",
        amountMinor: 2_900,
        currency: "USD",
        status: "failed",
      }),
    );
    expect(failed.status).toBe(200);
    expect(failed.body).toEqual({ status: "processed" });

    let invoice = await invoiceFor(test.account.agent, test.setup.invoice.id);
    expect(invoice.amountPaid.amountMinor).toBe(0);
    expect(invoice.payments[0]?.status).toBe("FAILED");
    expect(invoice.payments[0]?.failedAt).not.toBeNull();

    const captured = await postWebhook(
      test.app,
      test.mock.paymentEvent({
        eventType: "payment.captured",
        orderId: session.orderId,
        paymentId: "pay_retry_2",
        amountMinor: 2_900,
        currency: "USD",
      }),
    );
    expect(captured.status).toBe(200);
    expect(captured.body).toEqual({ status: "processed" });

    invoice = await invoiceFor(test.account.agent, test.setup.invoice.id);
    expect(invoice.status).toBe("PAID");
    expect(invoice.amountPaid.amountMinor).toBe(2_900);
    expect(invoice.payments[0]?.status).toBe("SUCCEEDED");

    const lateFailure = await postWebhook(
      test.app,
      test.mock.paymentEvent({
        eventType: "payment.failed",
        orderId: session.orderId,
        paymentId: "pay_retry_2",
        amountMinor: 2_900,
        currency: "USD",
        status: "failed",
      }),
    );
    expect(lateFailure.body).toEqual({ status: "ignored" });
    expect(
      (await invoiceFor(test.account.agent, test.setup.invoice.id))
        .payments[0]?.status,
    ).toBe("SUCCEEDED");
  });

  it("settles order.paid and ignores unsupported or unknown events", async () => {
    const test = await setupGatewayInvoice();
    const started = await startCheckout(
      test.account.agent,
      test.setup.invoice.id,
    );
    const session = started.body as GatewayCheckoutSession;

    const unsupported = await postWebhook(
      test.app,
      test.mock.rawEvent("subscription.charged", {}),
    );
    expect(unsupported.status).toBe(200);
    expect(unsupported.body).toEqual({ status: "ignored" });

    const unknown = await postWebhook(
      test.app,
      test.mock.paymentEvent({
        eventType: "payment.captured",
        orderId: "order_unknown",
        paymentId: "pay_unknown",
        amountMinor: 2_900,
        currency: "USD",
      }),
    );
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual({ status: "ignored" });

    const paid = await postWebhook(
      test.app,
      test.mock.paymentEvent({
        eventType: "order.paid",
        orderId: session.orderId,
        paymentId: "pay_order_paid",
        amountMinor: 2_900,
        currency: "USD",
        status: "captured",
        internalPaymentId: session.payment.id,
      }),
    );
    expect(paid.status).toBe(200);
    expect(paid.body).toEqual({ status: "processed" });

    const invoice = await invoiceFor(test.account.agent, test.setup.invoice.id);
    expect(invoice.status).toBe("PAID");
    expect(invoice.amountPaid.amountMinor).toBe(2_900);
  });
});

describe("gateway refunds", () => {
  it("supports partial and full refunds, releases failed reservations, and rejects over-refunds", async () => {
    const test = await setupGatewayInvoice();
    const captured = await capturedCheckout(test, test.setup);

    test.mock.refundStatus = "processed";
    const partial = await refundGatewayPayment(
      test.account.agent,
      captured.payment.id,
      { amountMinor: 1_000, reason: "Service credit" },
    );
    expect(partial.status).toBe(201);
    const partialBody = partial.body as GatewayRefundResponse;
    expect(partialBody.refund).toMatchObject({
      amount: { amountMinor: 1_000, currency: "USD" },
      status: "SUCCEEDED",
      reason: "Service credit",
      provider: "razorpay",
    });
    expect(partialBody.payment.refundedAmount.amountMinor).toBe(1_000);
    expect(partialBody.invoice.amountPaid.amountMinor).toBe(1_900);
    expect(partialBody.invoice.status).toBe("OPEN");
    expect(
      partialBody.invoice.activities.some(
        (activity) =>
          activity.type === "PAYMENT_REFUND_REQUESTED" ||
          activity.type === "PAYMENT_REFUNDED",
      ),
    ).toBe(true);

    const overRefund = await refundGatewayPayment(
      test.account.agent,
      captured.payment.id,
      { amountMinor: 2_000 },
    );
    expect(overRefund.status).toBe(409);
    expect(
      (await invoiceFor(test.account.agent, test.setup.invoice.id)).amountPaid
        .amountMinor,
    ).toBe(1_900);

    test.mock.refundStatus = "pending";
    const pending = await refundGatewayPayment(
      test.account.agent,
      captured.payment.id,
      { amountMinor: 1_000 },
    );
    expect(pending.status).toBe(201);
    const pendingBody = pending.body as GatewayRefundResponse;
    expect(pendingBody.refund.status).toBe("PENDING");
    expect(pendingBody.invoice.amountPaid.amountMinor).toBe(1_900);

    const refundFailed = await postWebhook(
      test.app,
      test.mock.refundEvent({
        eventType: "refund.failed",
        refundId: pendingBody.refund.providerRefundId ?? "rfnd_unknown",
        paymentId: captured.payment.gateway?.paymentId ?? "pay_unknown",
        amountMinor: 1_000,
        currency: "USD",
        internalRefundId: pendingBody.refund.id,
        status: "failed",
      }),
    );
    expect(refundFailed.status).toBe(200);
    expect(refundFailed.body).toEqual({ status: "processed" });

    const afterFailure = await invoiceFor(
      test.account.agent,
      test.setup.invoice.id,
    );
    expect(afterFailure.amountPaid.amountMinor).toBe(1_900);

    test.mock.refundStatus = "processed";
    const remaining = await refundGatewayPayment(
      test.account.agent,
      captured.payment.id,
      { amountMinor: 1_900 },
    );
    expect(remaining.status).toBe(201);
    const remainingBody = remaining.body as GatewayRefundResponse;
    expect(remainingBody.refund.status).toBe("SUCCEEDED");
    expect(remainingBody.payment.status).toBe("REFUNDED");
    expect(remainingBody.payment.refundedAmount.amountMinor).toBe(2_900);
    expect(remainingBody.invoice.amountPaid.amountMinor).toBe(0);
    expect(remainingBody.invoice.status).toBe("OPEN");

    const exhausted = await refundGatewayPayment(
      test.account.agent,
      captured.payment.id,
      { amountMinor: 1 },
    );
    expect(exhausted.status).toBe(409);
  });

  it("reconciles pending refund webhooks in order and ignores later failures", async () => {
    const test = await setupGatewayInvoice();
    const captured = await capturedCheckout(test, test.setup);
    test.mock.refundStatus = "pending";

    const pending = await refundGatewayPayment(
      test.account.agent,
      captured.payment.id,
      { amountMinor: 500, reason: "Partial credit" },
    );
    expect(pending.status).toBe(201);
    const pendingBody = pending.body as GatewayRefundResponse;
    const providerRefundId =
      pendingBody.refund.providerRefundId ?? "rfnd_missing";
    const providerPaymentId = captured.payment.gateway?.paymentId ?? "pay_missing";

    const created = await postWebhook(
      test.app,
      test.mock.refundEvent({
        eventType: "refund.created",
        refundId: providerRefundId,
        paymentId: providerPaymentId,
        amountMinor: 500,
        currency: "USD",
        internalRefundId: pendingBody.refund.id,
        status: "pending",
        reason: "Partial credit",
      }),
    );
    expect(created.status).toBe(200);
    expect(created.body).toEqual({ status: "processed" });

    const processed = await postWebhook(
      test.app,
      test.mock.refundEvent({
        eventType: "refund.processed",
        refundId: providerRefundId,
        paymentId: providerPaymentId,
        amountMinor: 500,
        currency: "USD",
        internalRefundId: pendingBody.refund.id,
        status: "processed",
      }),
    );
    expect(processed.status).toBe(200);
    expect(processed.body).toEqual({ status: "processed" });

    const invoice = await invoiceFor(test.account.agent, test.setup.invoice.id);
    expect(invoice.amountPaid.amountMinor).toBe(2_400);
    expect(invoice.payments[0]?.refundedAmount.amountMinor).toBe(500);
    expect(invoice.payments[0]?.status).toBe("SUCCEEDED");
    expect(invoice.payments[0]?.refunds[0]?.status).toBe("SUCCEEDED");

    const laterFailure = await postWebhook(
      test.app,
      test.mock.refundEvent({
        eventType: "refund.failed",
        refundId: providerRefundId,
        paymentId: providerPaymentId,
        amountMinor: 500,
        currency: "USD",
        internalRefundId: pendingBody.refund.id,
        status: "failed",
      }),
    );
    expect(laterFailure.status).toBe(200);
    expect(laterFailure.body).toEqual({ status: "ignored" });

    const finalInvoice = await invoiceFor(
      test.account.agent,
      test.setup.invoice.id,
    );
    expect(finalInvoice.amountPaid.amountMinor).toBe(2_400);
    expect(finalInvoice.payments[0]?.refundedAmount.amountMinor).toBe(500);
  });

  it("keeps an uncertain refund reserved and recovers it from a later webhook", async () => {
    for (const failure of ["network", "server"] as const) {
      const test = await setupGatewayInvoice();
      const captured = await capturedCheckout(test, test.setup);

      test.mock.refundFailure = failure;
      const uncertain = await refundGatewayPayment(
        test.account.agent,
        captured.payment.id,
        { amountMinor: 500, reason: "Uncertain refund" },
      );
      expect(uncertain.status).toBe(502);
      expect((uncertain.body as ApiErrorResponse).error.code).toBe(
        "BAD_GATEWAY",
      );

      let invoice = await invoiceFor(
        test.account.agent,
        test.setup.invoice.id,
      );
      expect(invoice.amountPaid.amountMinor).toBe(2_900);
      expect(invoice.payments[0]?.refundedAmount.amountMinor).toBe(0);
      expect(invoice.payments[0]?.refunds).toHaveLength(1);
      expect(invoice.payments[0]?.refunds[0]).toMatchObject({
        status: "PENDING",
        providerRefundId: null,
        amount: { amountMinor: 500, currency: "USD" },
      });

      const reservedRefund = invoice.payments[0]?.refunds[0];

      if (!reservedRefund) {
        throw new Error("The uncertain refund reservation was not created.");
      }

      test.mock.refundFailure = "none";
      const processed = await postWebhook(
        test.app,
        test.mock.refundEvent({
          eventType: "refund.processed",
          refundId: `rfnd_recovered_${failure}`,
          paymentId: captured.payment.gateway?.paymentId ?? "pay_missing",
          amountMinor: 500,
          currency: "USD",
          internalRefundId: reservedRefund.id,
          status: "processed",
        }),
      );
      expect(processed.status).toBe(200);
      expect(processed.body).toEqual({ status: "processed" });

      invoice = await invoiceFor(test.account.agent, test.setup.invoice.id);
      expect(invoice.amountPaid.amountMinor).toBe(2_400);
      expect(invoice.payments[0]?.refundedAmount.amountMinor).toBe(500);
      expect(invoice.payments[0]?.refunds[0]).toMatchObject({
        id: reservedRefund.id,
        status: "SUCCEEDED",
        providerRefundId: `rfnd_recovered_${failure}`,
      });
    }
  });

  it("releases the reservation when the provider explicitly rejects a refund", async () => {
    const test = await setupGatewayInvoice();
    const captured = await capturedCheckout(test, test.setup);

    test.mock.refundFailure = "rejected";
    const rejected = await refundGatewayPayment(
      test.account.agent,
      captured.payment.id,
      { amountMinor: 2_900, reason: "Rejected refund" },
    );
    expect(rejected.status).toBe(502);
    expect((rejected.body as ApiErrorResponse).error.code).toBe("BAD_GATEWAY");
    expect(test.mock.refunds.size).toBe(0);

    const afterRejection = await invoiceFor(
      test.account.agent,
      test.setup.invoice.id,
    );
    expect(afterRejection.amountPaid.amountMinor).toBe(2_900);
    expect(afterRejection.payments[0]?.refundedAmount.amountMinor).toBe(0);
    expect(afterRejection.payments[0]?.refunds[0]?.status).toBe("FAILED");
    expect(
      afterRejection.activities.some(
        (activity) => activity.type === "PAYMENT_REFUND_FAILED",
      ),
    ).toBe(true);

    test.mock.refundFailure = "none";
    const retried = await refundGatewayPayment(
      test.account.agent,
      captured.payment.id,
      { amountMinor: 2_900 },
    );
    expect(retried.status).toBe(201);
    const retriedBody = retried.body as GatewayRefundResponse;
    expect(retriedBody.refund.status).toBe("SUCCEEDED");
    expect(retriedBody.payment.status).toBe("REFUNDED");
    expect(retriedBody.invoice.amountPaid.amountMinor).toBe(0);
  });

  it("creates a refund ledger entry for a provider-originated processed refund", async () => {
    const test = await setupGatewayInvoice();
    const captured = await capturedCheckout(test, test.setup);
    const providerPaymentId = captured.payment.gateway?.paymentId ?? "pay_missing";

    const processed = await postWebhook(
      test.app,
      test.mock.refundEvent({
        eventType: "refund.processed",
        refundId: "rfnd_from_dashboard",
        paymentId: providerPaymentId,
        amountMinor: 700,
        currency: "USD",
        status: "processed",
        reason: "Dashboard refund",
      }),
    );
    expect(processed.status).toBe(200);
    expect(processed.body).toEqual({ status: "processed" });

    const invoice = await invoiceFor(test.account.agent, test.setup.invoice.id);
    expect(invoice.amountPaid.amountMinor).toBe(2_200);
    expect(invoice.payments[0]?.refundedAmount.amountMinor).toBe(700);
    expect(invoice.payments[0]?.refunds).toHaveLength(1);
    expect(invoice.payments[0]?.refunds[0]).toMatchObject({
      provider: "razorpay",
      providerRefundId: "rfnd_from_dashboard",
      amount: { amountMinor: 700, currency: "USD" },
      status: "SUCCEEDED",
      reason: "Dashboard refund",
    });
  });

  it("refuses gateway actions on manual payments", async () => {
    const test = await setupGatewayInvoice();
    const manual = await recordPayment(
      test.account.agent,
      test.setup.invoice.id,
      { amountMinor: 2_900, method: "CASH" },
    );
    expect(manual.status).toBe(201);
    const manualPayment = (manual.body as PaymentActionResponse).payment;

    expect(
      (
        await refundGatewayPayment(test.account.agent, manualPayment.id, {
          amountMinor: 100,
        })
      ).status,
    ).toBe(409);
    expect(
      (await cancelCheckout(test.account.agent, manualPayment.id)).status,
    ).toBe(409);
    expect(
      (
        await verifyCheckout(test.account.agent, manualPayment.id, {
          orderId: "order_manual",
          gatewayPaymentId: "pay_manual",
          signature: "0".repeat(64),
        })
      ).status,
    ).toBe(409);

    expect(
      (await invoiceFor(test.account.agent, test.setup.invoice.id)).amountPaid
        .amountMinor,
    ).toBe(2_900);
  });
});

describe("gateway rate limiting", () => {
  it("returns a consistent 429 envelope for repeated gateway requests", async () => {
    const test = await setupGatewayInvoice({
      appOptions: { gatewayRateLimit: { windowMs: 60_000, limit: 2 } },
    });

    expect((await test.account.agent.get(API_PATHS.gatewayConfig)).status).toBe(
      200,
    );
    expect((await test.account.agent.get(API_PATHS.gatewayConfig)).status).toBe(
      200,
    );
    const limited = await test.account.agent.get(API_PATHS.gatewayConfig);
    expect(limited.status).toBe(429);
    expect((limited.body as ApiErrorResponse).error.code).toBe(
      "TOO_MANY_REQUESTS",
    );
    expect((limited.body as ApiErrorResponse).error.requestId).toBe(
      limited.headers["x-request-id"],
    );
  });

  it("rate limits webhook deliveries independently", async () => {
    const test = await setupGatewayInvoice({
      appOptions: { webhookRateLimit: { windowMs: 60_000, limit: 1 } },
    });
    const delivery = test.mock.rawEvent("ignored", {});

    expect(
      (await postWebhook(test.app, delivery, { signature: "bad" })).status,
    ).toBe(400);
    expect((await postWebhook(test.app, delivery)).status).toBe(429);
  });
});
