import { createHmac, randomUUID } from "node:crypto";
import { createRazorpayGateway } from "../../src/gateway/razorpay.js";
import type {
  GatewayWebhookEventType,
  PaymentGateway,
} from "../../src/gateway/types.js";

export const RAZORPAY_TEST_KEY_ID = "rzp_test_SubscriptMock";
export const RAZORPAY_TEST_KEY_SECRET = "test_key_secret_1234567890";
export const RAZORPAY_TEST_WEBHOOK_SECRET = "test_webhook_secret_1234567890";

export interface MockOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
  status: string;
  created_at: number;
}

export interface MockPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  notes: Record<string, string>;
  created_at: number;
}

export interface MockRefund {
  id: string;
  payment_id: string;
  amount: number;
  currency: string;
  status: string;
  notes: Record<string, string>;
  created_at: number;
}

export interface MockRequest {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

export interface WebhookDelivery {
  eventId: string;
  rawBody: Buffer;
  signature: string;
}

export interface PaymentWebhookInput {
  eventType?: Extract<
    GatewayWebhookEventType,
    "payment.captured" | "payment.failed" | "order.paid"
  >;
  orderId: string | null;
  paymentId: string;
  amountMinor: number;
  currency: string;
  status?: string;
  method?: string | null;
  internalPaymentId?: string | null;
  eventId?: string;
}

export interface RefundWebhookInput {
  eventType?: Extract<
    GatewayWebhookEventType,
    "refund.created" | "refund.processed" | "refund.failed"
  >;
  refundId: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  status?: string;
  internalRefundId?: string | null;
  reason?: string | null;
  eventId?: string;
}

export interface AddPaymentInput {
  orderId?: string;
  paymentId?: string;
  amountMinor?: number;
  currency?: string;
  status?: string;
  method?: string | null;
  internalPaymentId?: string | null;
}

export type MockRefundFailure = "none" | "network" | "server" | "rejected";

export interface RazorpayMock {
  gateway: PaymentGateway;
  orders: Map<string, MockOrder>;
  payments: Map<string, MockPayment>;
  refunds: Map<string, MockRefund>;
  requests: MockRequest[];
  /** Status returned by the mocked refund endpoint. */
  refundStatus: "pending" | "processed" | "failed";
  /** Failure injected into the next refund requests until reset. */
  refundFailure: MockRefundFailure;
  addPayment(input?: AddPaymentInput): MockPayment;
  checkoutSignature(orderId: string, paymentId: string): string;
  signWebhook(rawBody: Buffer): string;
  paymentEvent(input: PaymentWebhookInput): WebhookDelivery;
  refundEvent(input: RefundWebhookInput): WebhookDelivery;
  rawEvent(
    eventType: string,
    payload: Record<string, unknown>,
    eventId?: string,
  ): WebhookDelivery;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function hmacHex(secret: string, value: string | Buffer): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function epochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createRazorpayMock(): RazorpayMock {
  const orders = new Map<string, MockOrder>();
  const payments = new Map<string, MockPayment>();
  const refunds = new Map<string, MockRefund>();
  const requests: MockRequest[] = [];
  const expectedAuthorization = `Basic ${Buffer.from(
    `${RAZORPAY_TEST_KEY_ID}:${RAZORPAY_TEST_KEY_SECRET}`,
  ).toString("base64")}`;
  let orderCounter = 0;
  let paymentCounter = 0;
  let refundCounter = 0;
  let deliveryCounter = 0;

  function nextDeliveryId(prefix: string): string {
    deliveryCounter += 1;
    return `${prefix}_${deliveryCounter}_${randomUUID().slice(0, 8)}`;
  }

  function signedDelivery(
    body: Record<string, unknown>,
    eventId?: string,
  ): WebhookDelivery {
    const rawBody = Buffer.from(JSON.stringify(body), "utf8");

    return {
      eventId: eventId ?? nextDeliveryId("evt"),
      rawBody,
      signature: hmacHex(RAZORPAY_TEST_WEBHOOK_SECRET, rawBody),
    };
  }

  function paymentEntity(input: PaymentWebhookInput): Record<string, unknown> {
    return {
      id: input.paymentId,
      entity: "payment",
      order_id: input.orderId,
      amount: input.amountMinor,
      currency: input.currency,
      status: input.status ?? "captured",
      method: input.method ?? "card",
      notes:
        input.internalPaymentId === null ||
        input.internalPaymentId === undefined
          ? {}
          : { paymentId: input.internalPaymentId },
      created_at: epochSeconds(),
    };
  }

  function refundEntity(input: RefundWebhookInput): Record<string, unknown> {
    return {
      id: input.refundId,
      entity: "refund",
      payment_id: input.paymentId,
      amount: input.amountMinor,
      currency: input.currency,
      status: input.status ?? "processed",
      notes: {
        ...(input.internalRefundId
          ? { refundId: input.internalRefundId }
          : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      },
      created_at: epochSeconds(),
    };
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const requestPath = new URL(url).pathname.replace(/^\/v1/, "");
    const rawBody = typeof init?.body === "string" ? init.body : null;
    let body: unknown = null;

    if (rawBody) {
      try {
        body = JSON.parse(rawBody) as unknown;
      } catch {
        body = rawBody;
      }
    }

    requests.push({
      method,
      path: requestPath,
      authorization: headers.get("authorization"),
      body,
    });

    if (headers.get("authorization") !== expectedAuthorization) {
      return jsonResponse(
        { error: { description: "Authentication failed." } },
        401,
      );
    }

    if (method === "POST" && requestPath === "/orders") {
      orderCounter += 1;
      const payload = (body ?? {}) as Record<string, unknown>;
      const order: MockOrder = {
        id: `order_mock_${orderCounter}`,
        amount: Number(payload.amount),
        currency: String(payload.currency),
        receipt: String(payload.receipt ?? ""),
        notes: (payload.notes as Record<string, string> | undefined) ?? {},
        status: "created",
        created_at: epochSeconds(),
      };

      orders.set(order.id, order);

      return jsonResponse(order);
    }

    const paymentMatch = requestPath.match(/^\/payments\/([^/]+)$/);

    if (method === "GET" && paymentMatch) {
      const payment = payments.get(decodeURIComponent(paymentMatch[1] ?? ""));

      if (!payment) {
        return jsonResponse(
          { error: { description: "Payment not found." } },
          404,
        );
      }

      return jsonResponse(payment);
    }

    const refundMatch = requestPath.match(/^\/payments\/([^/]+)\/refund$/);

    if (method === "POST" && refundMatch) {
      if (mock.refundFailure === "network") {
        throw new TypeError("fetch failed");
      }

      if (mock.refundFailure === "server") {
        return jsonResponse(
          { error: { description: "The provider is temporarily unavailable." } },
          503,
        );
      }

      if (mock.refundFailure === "rejected") {
        return jsonResponse(
          { error: { description: "Refund amount exceeds the payment amount." } },
          400,
        );
      }

      const payment = payments.get(decodeURIComponent(refundMatch[1] ?? ""));

      if (!payment) {
        return jsonResponse(
          { error: { description: "Payment not found." } },
          404,
        );
      }

      refundCounter += 1;
      const payload = (body ?? {}) as Record<string, unknown>;
      const refund: MockRefund = {
        id: `rfnd_mock_${refundCounter}`,
        payment_id: payment.id,
        amount: Number(payload.amount),
        currency: payment.currency,
        status: refundStatusRef(),
        notes: (payload.notes as Record<string, string> | undefined) ?? {},
        created_at: epochSeconds(),
      };

      refunds.set(refund.id, refund);

      return jsonResponse(refund, 201);
    }

    return jsonResponse({ error: { description: "Not found." } }, 404);
  };

  function refundStatusRef(): string {
    return mock.refundStatus;
  }

  const gateway = createRazorpayGateway({
    keyId: RAZORPAY_TEST_KEY_ID,
    keySecret: RAZORPAY_TEST_KEY_SECRET,
    webhookSecret: RAZORPAY_TEST_WEBHOOK_SECRET,
    baseUrl: "https://api.razorpay.test/v1",
    fetchImpl,
    timeoutMs: 5_000,
  });

  const mock: RazorpayMock = {
    gateway,
    orders,
    payments,
    refunds,
    requests,
    refundStatus: "processed",
    refundFailure: "none",
    addPayment(input = {}) {
      paymentCounter += 1;
      const order = input.orderId ? orders.get(input.orderId) : undefined;
      const payment: MockPayment = {
        id: input.paymentId ?? `pay_mock_${paymentCounter}`,
        order_id: input.orderId ?? null,
        amount: input.amountMinor ?? order?.amount ?? 0,
        currency: input.currency ?? order?.currency ?? "USD",
        status: input.status ?? "captured",
        method: input.method ?? "card",
        notes: input.internalPaymentId
          ? { paymentId: input.internalPaymentId }
          : {},
        created_at: epochSeconds(),
      };

      payments.set(payment.id, payment);

      return payment;
    },
    checkoutSignature(orderId, paymentId) {
      return hmacHex(
        RAZORPAY_TEST_KEY_SECRET,
        `${orderId}|${paymentId}`,
      );
    },
    signWebhook(rawBody) {
      return hmacHex(RAZORPAY_TEST_WEBHOOK_SECRET, rawBody);
    },
    paymentEvent(input) {
      return signedDelivery(
        {
          entity: "event",
          event: input.eventType ?? "payment.captured",
          created_at: epochSeconds(),
          payload: { payment: { entity: paymentEntity(input) } },
        },
        input.eventId,
      );
    },
    refundEvent(input) {
      return signedDelivery(
        {
          entity: "event",
          event: input.eventType ?? "refund.processed",
          created_at: epochSeconds(),
          payload: { refund: { entity: refundEntity(input) } },
        },
        input.eventId,
      );
    },
    rawEvent(eventType, payload, eventId) {
      return signedDelivery(
        {
          entity: "event",
          event: eventType,
          created_at: epochSeconds(),
          payload,
        },
        eventId,
      );
    },
  };

  return mock;
}
