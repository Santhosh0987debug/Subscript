import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PaymentStateConflictError } from "../src/billing/errors.js";
import { createPrismaClient } from "../src/db/prisma.js";
import type {
  NormalizedGatewayPaymentEvent,
  NormalizedGatewayRefundEvent,
} from "../src/gateway/types.js";
import { createPrismaGatewayWebhookStore } from "../src/gateway/store/prisma.js";
import { createPrismaInvoiceStore } from "../src/invoices/store/prisma.js";
import type {
  GenerateInvoiceInput,
  PaymentRecord,
} from "../src/invoices/types.js";

/**
 * Real-PostgreSQL checks for gateway transaction, row-lock, idempotency and
 * uniqueness paths. Enabled only when TEST_DATABASE_URL points at a
 * disposable database; no provider network call is made.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("gateway PostgreSQL store", () => {
  const prisma = createPrismaClient(databaseUrl ?? "");
  const invoiceStore = createPrismaInvoiceStore(prisma);
  const webhookStore = createPrismaGatewayWebhookStore(prisma);
  const organizationIds: string[] = [];
  const providerEventIds: string[] = [];
  const actor = { actorId: null, actorName: "Gateway PostgreSQL test" };

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

    if (providerEventIds.length > 0) {
      await prisma.gatewayWebhookEvent.deleteMany({
        where: {
          provider: "razorpay",
          providerEventId: { in: providerEventIds },
        },
      });
    }

    await prisma.$disconnect();
  });

  async function createFixtures() {
    const organizationId = randomUUID();
    const customerId = randomUUID();
    const planId = randomUUID();
    const subscriptionId = randomUUID();
    const periodStart = new Date("2026-01-01T00:00:00.000Z");
    const periodEnd = new Date("2026-02-01T00:00:00.000Z");

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Gateway PostgreSQL Workspace",
        slug: `gateway-${organizationId}`,
        defaultCurrency: "USD",
      },
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        organizationId,
        name: "Gateway Customer",
        email: `gateway-${customerId}@example.test`,
      },
    });
    await prisma.plan.create({
      data: {
        id: planId,
        organizationId,
        name: "Gateway Plan",
        code: `gateway-${planId}`,
        amountMinor: 2_900,
        currency: "USD",
        interval: "MONTH",
        trialDays: 0,
      },
    });
    await prisma.subscription.create({
      data: {
        id: subscriptionId,
        organizationId,
        customerId,
        planId,
        status: "ACTIVE",
        quantity: 1,
        startedAt: periodStart,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        planName: "Gateway Plan",
        planCode: `gateway-${planId}`,
        unitAmountMinor: 2_900,
        currency: "USD",
        interval: "MONTH",
        trialDays: 0,
      },
    });
    organizationIds.push(organizationId);

    return {
      organizationId,
      customerId,
      subscriptionId,
      periodStart,
      periodEnd,
    };
  }

  function invoiceInput(
    fixtures: Awaited<ReturnType<typeof createFixtures>>,
  ): GenerateInvoiceInput {
    return {
      organizationId: fixtures.organizationId,
      subscriptionId: fixtures.subscriptionId,
      customerId: fixtures.customerId,
      customerName: "Gateway Customer",
      customerEmail: "gateway@example.test",
      customerCompany: null,
      billingAddress: {
        line1: "1 Gateway Way",
        line2: "",
        city: "Postgres",
        region: "CA",
        postalCode: "94105",
        country: "United States",
      },
      periodStart: fixtures.periodStart,
      periodEnd: fixtures.periodEnd,
      quantity: 1,
      unitAmountMinor: 2_900,
      currency: "USD",
      lineDescription: "Gateway Plan",
      taxRateBps: 0,
      dueInDays: 7,
      actor,
    };
  }

  async function openInvoice(
    fixtures: Awaited<ReturnType<typeof createFixtures>>,
  ) {
    const generated = await invoiceStore.generate(invoiceInput(fixtures));

    return invoiceStore.applyAction(
      fixtures.organizationId,
      generated.invoice.id,
      "issue",
      actor,
    );
  }

  async function reserveCheckout(
    organizationId: string,
    invoiceId: string,
  ) {
    return invoiceStore.reserveGatewayCheckout({
      organizationId,
      invoiceId,
      provider: "razorpay",
      actor,
      staleAfterMs: 30 * 60 * 1000,
    });
  }

  async function attachOrder(
    organizationId: string,
    paymentId: string,
    orderId: string,
  ) {
    return invoiceStore.attachGatewayOrder({
      organizationId,
      paymentId,
      provider: "razorpay",
      gatewayOrderId: orderId,
      gatewayStatus: "created",
      metadata: { amountMinor: 2_900, currency: "USD" },
    });
  }

  async function confirm(
    organizationId: string,
    payment: PaymentRecord,
    orderId: string,
    gatewayPaymentId: string,
  ) {
    return invoiceStore.confirmGatewayPayment({
      organizationId,
      paymentId: payment.id,
      provider: "razorpay",
      gatewayOrderId: orderId,
      gatewayPaymentId,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      gatewayStatus: "captured",
      actor,
    });
  }

  function nextEventId(label: string): string {
    const eventId = `evt_pg_${label}_${randomUUID()}`;
    providerEventIds.push(eventId);
    return eventId;
  }

  function paymentCaptured(
    payment: PaymentRecord,
    orderId: string,
    gatewayPaymentId: string,
    eventId: string,
  ): NormalizedGatewayPaymentEvent {
    return {
      kind: "payment",
      provider: "razorpay",
      eventId,
      eventType: "payment.captured",
      createdAt: new Date(),
      gatewayOrderId: orderId,
      gatewayPaymentId,
      internalPaymentId: payment.id,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      gatewayStatus: "captured",
      raw: {},
    };
  }

  function refundProcessed(
    payment: PaymentRecord,
    refundId: string,
    gatewayRefundId: string,
    gatewayPaymentId: string,
    amountMinor: number,
    eventId: string,
  ): NormalizedGatewayRefundEvent {
    return {
      kind: "refund",
      provider: "razorpay",
      eventId,
      eventType: "refund.processed",
      createdAt: new Date(),
      gatewayRefundId,
      gatewayPaymentId,
      internalRefundId: refundId,
      amountMinor,
      currency: payment.currency,
      gatewayStatus: "processed",
      reason: "PostgreSQL refund",
      raw: {},
    };
  }

  it("allows exactly one concurrent checkout reservation per invoice", async () => {
    const fixtures = await createFixtures();
    const invoice = await openInvoice(fixtures);

    const attempts = await Promise.allSettled([
      reserveCheckout(fixtures.organizationId, invoice.id),
      reserveCheckout(fixtures.organizationId, invoice.id),
      reserveCheckout(fixtures.organizationId, invoice.id),
    ]);
    const fulfilled = attempts.filter(
      (result) => result.status === "fulfilled",
    );
    const rejected = attempts.filter(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(PaymentStateConflictError);
    }

    const refreshed = await invoiceStore.findById(
      fixtures.organizationId,
      invoice.id,
    );
    expect(refreshed?.amountPaidMinor).toBe(0);
    expect(refreshed?.payments).toHaveLength(1);
    expect(refreshed?.payments[0]?.source).toBe("GATEWAY");
    expect(refreshed?.payments[0]?.status).toBe("PENDING");
  });

  it("applies concurrent captures and duplicate webhook events only once", async () => {
    const fixtures = await createFixtures();
    const invoice = await openInvoice(fixtures);
    const reservation = await reserveCheckout(
      fixtures.organizationId,
      invoice.id,
    );
    const orderId = "order_pg_capture";
    await attachOrder(
      fixtures.organizationId,
      reservation.payment.id,
      orderId,
    );
    const gatewayPaymentId = "pay_pg_capture";

    const direct = await Promise.allSettled([
      confirm(
        fixtures.organizationId,
        reservation.payment,
        orderId,
        gatewayPaymentId,
      ),
      confirm(
        fixtures.organizationId,
        reservation.payment,
        orderId,
        gatewayPaymentId,
      ),
    ]);
    expect(
      direct.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);

    const refreshed = await invoiceStore.findById(
      fixtures.organizationId,
      invoice.id,
    );
    expect(refreshed?.amountPaidMinor).toBe(2_900);
    expect(refreshed?.status).toBe("PAID");

    const second = await createFixtures();
    const secondInvoice = await openInvoice(second);
    const secondReservation = await reserveCheckout(
      second.organizationId,
      secondInvoice.id,
    );
    const secondOrderId = "order_pg_webhook";
    await attachOrder(
      second.organizationId,
      secondReservation.payment.id,
      secondOrderId,
    );
    const secondGatewayPaymentId = "pay_pg_webhook";

    const events = await Promise.allSettled([
      invoiceStore.processGatewayEvent(
        paymentCaptured(
          secondReservation.payment,
          secondOrderId,
          secondGatewayPaymentId,
          nextEventId("capture_a"),
        ),
      ),
      invoiceStore.processGatewayEvent(
        paymentCaptured(
          secondReservation.payment,
          secondOrderId,
          secondGatewayPaymentId,
          nextEventId("capture_b"),
        ),
      ),
    ]);

    expect(
      events.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);
    const outcomes = events.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.outcome] : [],
    );
    expect(outcomes.sort()).toEqual(["applied", "ignored"]);

    const secondRefreshed = await invoiceStore.findById(
      second.organizationId,
      secondInvoice.id,
    );
    expect(secondRefreshed?.amountPaidMinor).toBe(2_900);
    expect(secondRefreshed?.status).toBe("PAID");
  });

  it("serializes refund reservations and duplicate refund webhooks", async () => {
    const fixtures = await createFixtures();
    const invoice = await openInvoice(fixtures);
    const reservation = await reserveCheckout(
      fixtures.organizationId,
      invoice.id,
    );
    const orderId = "order_pg_refund";
    await attachOrder(fixtures.organizationId, reservation.payment.id, orderId);
    const gatewayPaymentId = "pay_pg_refund";
    const confirmed = await confirm(
      fixtures.organizationId,
      reservation.payment,
      orderId,
      gatewayPaymentId,
    );

    const attempts = await Promise.allSettled([
      invoiceStore.reserveGatewayRefund({
        organizationId: fixtures.organizationId,
        paymentId: confirmed.payment.id,
        provider: "razorpay",
        amountMinor: 2_000,
        reason: "First",
        actor,
      }),
      invoiceStore.reserveGatewayRefund({
        organizationId: fixtures.organizationId,
        paymentId: confirmed.payment.id,
        provider: "razorpay",
        amountMinor: 2_000,
        reason: "Second",
        actor,
      }),
    ]);
    const reserved = attempts.filter(
      (result) => result.status === "fulfilled",
    ) as PromiseFulfilledResult<{ refund: { id: string } }>[];

    expect(reserved).toHaveLength(1);
    expect(
      attempts.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const refundId = reserved[0]?.value.refund.id;

    if (!refundId) {
      throw new Error("Refund reservation was not created.");
    }

    const gatewayRefundId = "rfnd_pg_1";
    const events = await Promise.allSettled([
      invoiceStore.processGatewayEvent(
        refundProcessed(
          confirmed.payment,
          refundId,
          gatewayRefundId,
          gatewayPaymentId,
          2_000,
          nextEventId("refund_a"),
        ),
      ),
      invoiceStore.processGatewayEvent(
        refundProcessed(
          confirmed.payment,
          refundId,
          gatewayRefundId,
          gatewayPaymentId,
          2_000,
          nextEventId("refund_b"),
        ),
      ),
    ]);
    const refundOutcomes = events.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.outcome] : [],
    );
    expect(refundOutcomes.sort()).toEqual(["applied", "ignored"]);

    const refreshed = await invoiceStore.findById(
      fixtures.organizationId,
      invoice.id,
    );
    expect(refreshed?.amountPaidMinor).toBe(900);
    expect(refreshed?.payments[0]?.refundedAmountMinor).toBe(2_000);
    expect(refreshed?.payments[0]?.refunds).toHaveLength(1);
    expect(refreshed?.payments[0]?.refunds[0]?.status).toBe("SUCCEEDED");
  });

  it("claims persistent webhook events once, deduplicates terminal events, and allows retries", async () => {
    const eventId = nextEventId("claim");
    const payload = { event: "payment.captured" };
    const claims = await Promise.all([
      webhookStore.claim({
        provider: "razorpay",
        providerEventId: eventId,
        eventType: "payment.captured",
        payload,
      }),
      webhookStore.claim({
        provider: "razorpay",
        providerEventId: eventId,
        eventType: "payment.captured",
        payload,
      }),
    ]);

    expect(claims.filter((claim) => claim.created)).toHaveLength(1);
    const existing = claims.find((claim) => !claim.created);
    expect(existing?.inProgress).toBe(true);

    const created = claims.find((claim) => claim.created);
    if (!created) {
      throw new Error("The webhook event was not created.");
    }

    await webhookStore.markProcessed(created.event.id, {
      status: "PROCESSED",
      organizationId: null,
      paymentId: null,
    });
    const duplicate = await webhookStore.claim({
      provider: "razorpay",
      providerEventId: eventId,
      eventType: "payment.captured",
      payload,
    });
    expect(duplicate.created).toBe(false);
    expect(duplicate.inProgress).toBe(false);
    expect(duplicate.event.status).toBe("PROCESSED");

    const retryId = nextEventId("retry");
    const first = await webhookStore.claim({
      provider: "razorpay",
      providerEventId: retryId,
      eventType: "payment.failed",
      payload,
    });
    await webhookStore.markFailed(first.event.id, "temporary failure");
    const retried = await webhookStore.claim({
      provider: "razorpay",
      providerEventId: retryId,
      eventType: "payment.failed",
      payload,
    });
    expect(retried.created).toBe(false);
    expect(retried.inProgress).toBe(false);
    expect(retried.event.status).toBe("RECEIVED");
    expect(retried.event.error).toBeNull();
  });

  it("keeps gateway mutations organization scoped", async () => {
    const fixtures = await createFixtures();
    const other = await createFixtures();
    const invoice = await openInvoice(fixtures);
    const reservation = await reserveCheckout(
      fixtures.organizationId,
      invoice.id,
    );

    await expect(
      attachOrder(
        other.organizationId,
        reservation.payment.id,
        "order_cross_tenant",
      ),
    ).rejects.toBeInstanceOf(PaymentStateConflictError);
    await expect(
      confirm(
        other.organizationId,
        reservation.payment,
        "order_cross_tenant",
        "pay_cross_tenant",
      ),
    ).rejects.toBeInstanceOf(PaymentStateConflictError);
    await expect(
      invoiceStore.reserveGatewayRefund({
        organizationId: other.organizationId,
        paymentId: reservation.payment.id,
        provider: "razorpay",
        amountMinor: 100,
        reason: null,
        actor,
      }),
    ).rejects.toBeInstanceOf(PaymentStateConflictError);
    await expect(
      invoiceStore.findPaymentById(
        other.organizationId,
        reservation.payment.id,
      ),
    ).resolves.toBeNull();
    expect(
      await invoiceStore.findById(other.organizationId, invoice.id),
    ).toBeNull();
  });
});
