import { createHmac, timingSafeEqual } from "node:crypto";
import { GatewayPayloadError, GatewayRequestError } from "./errors.js";
import type {
  CreateGatewayOrderInput,
  CreateGatewayRefundInput,
  GatewayOrder,
  GatewayPayment,
  GatewayRefund,
  NormalizedGatewayWebhookEvent,
  PaymentGateway,
  VerifyGatewayPaymentSignatureInput,
} from "./types.js";

export interface RazorpayGatewayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  /** Override for tests or a private proxy. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface RazorpayRequestOptions {
  method: "GET" | "POST";
  body?: unknown;
}

interface RazorpayEntity {
  id?: unknown;
  order_id?: unknown;
  payment_id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  method?: unknown;
  created_at?: unknown;
  notes?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GatewayPayloadError(`The gateway payload is missing ${field}.`);
  }

  return value;
}

function requireMinorUnits(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new GatewayPayloadError(
      `The gateway payload contains an invalid ${field}.`,
    );
  }

  return value;
}

function optionalDate(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return new Date(value * 1000);
}

function entityFrom(
  payload: Record<string, unknown>,
  key: "payment" | "refund" | "order",
): RazorpayEntity | null {
  const container = payload[key];

  if (!isRecord(container) || !isRecord(container.entity)) {
    return null;
  }

  return container.entity as RazorpayEntity;
}

function safeEqualHex(expected: string, received: string): boolean {
  if (!/^[a-f0-9]+$/i.test(received) || received.length !== expected.length) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");

  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

function hmacHex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

/**
 * Thin official-REST adapter. No Razorpay SDK is required and no secret is
 * ever included in a response or log line.
 */
export function createRazorpayGateway(
  config: RazorpayGatewayConfig,
): PaymentGateway {
  const baseUrl = (config.baseUrl ?? "https://api.razorpay.com/v1").replace(
    /\/+$/,
    "",
  );
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 15_000;
  const authorization = `Basic ${Buffer.from(
    `${config.keyId}:${config.keySecret}`,
  ).toString("base64")}`;

  async function request<T>(
    path: string,
    options: RazorpayRequestOptions,
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: options.method,
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new GatewayRequestError(
        "The payment provider could not be reached. Try again shortly.",
      );
    }

    const text = await response.text();
    let payload: unknown = null;

    if (text.length > 0) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const providerMessage =
        isRecord(payload) && isRecord(payload.error)
          ? payload.error.description
          : null;

      throw new GatewayRequestError(
        typeof providerMessage === "string" && providerMessage.length > 0
          ? `The payment provider rejected the request: ${providerMessage}`
          : "The payment provider rejected the request.",
        response.status,
      );
    }

    if (!isRecord(payload)) {
      throw new GatewayRequestError(
        "The payment provider returned an unexpected response.",
        response.status,
      );
    }

    return payload as T;
  }

  function verifyCheckoutSignature(
    input: VerifyGatewayPaymentSignatureInput,
  ): boolean {
    const expected = hmacHex(
      config.keySecret,
      `${input.orderId}|${input.gatewayPaymentId}`,
    );

    return safeEqualHex(expected, input.signature);
  }

  function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const expected = hmacHex(config.webhookSecret, rawBody.toString("utf8"));

    return safeEqualHex(expected, signature);
  }

  function parseWebhookEvent(input: {
    rawBody: Buffer;
    eventId: string;
  }): NormalizedGatewayWebhookEvent {
    let body: unknown;

    try {
      body = JSON.parse(input.rawBody.toString("utf8")) as unknown;
    } catch {
      throw new GatewayPayloadError("The webhook body is not valid JSON.");
    }

    if (!isRecord(body) || typeof body.event !== "string") {
      throw new GatewayPayloadError("The webhook body is missing its event name.");
    }

    const eventType = body.event;
    const payload = isRecord(body.payload) ? body.payload : {};
    const createdAt = optionalDate(body.created_at);

    if (
      eventType === "payment.captured" ||
      eventType === "payment.failed" ||
      eventType === "order.paid"
    ) {
      const payment = entityFrom(payload, "payment");

      if (!payment) {
        throw new GatewayPayloadError(
          "The payment webhook is missing its payment entity.",
        );
      }

      const notes = isRecord(payment.notes) ? payment.notes : null;

      return {
        kind: "payment",
        provider: "razorpay",
        eventId: input.eventId,
        eventType,
        createdAt,
        gatewayOrderId:
          typeof payment.order_id === "string" ? payment.order_id : null,
        gatewayPaymentId: requireString(payment.id, "payment id"),
        internalPaymentId:
          notes && typeof notes.paymentId === "string"
            ? notes.paymentId
            : null,
        amountMinor: requireMinorUnits(payment.amount, "payment amount"),
        currency: requireString(payment.currency, "payment currency"),
        gatewayStatus: requireString(payment.status, "payment status"),
        raw: body,
      };
    }

    if (
      eventType === "refund.created" ||
      eventType === "refund.processed" ||
      eventType === "refund.failed"
    ) {
      const refund = entityFrom(payload, "refund");

      if (!refund) {
        throw new GatewayPayloadError(
          "The refund webhook is missing its refund entity.",
        );
      }

      const notes = isRecord(refund.notes) ? refund.notes : null;
      const reason =
        notes && typeof notes.reason === "string" ? notes.reason : null;

      return {
        kind: "refund",
        provider: "razorpay",
        eventId: input.eventId,
        eventType,
        createdAt,
        gatewayRefundId: requireString(refund.id, "refund id"),
        gatewayPaymentId: requireString(refund.payment_id, "payment id"),
        internalRefundId:
          notes && typeof notes.refundId === "string" ? notes.refundId : null,
        amountMinor: requireMinorUnits(refund.amount, "refund amount"),
        currency: requireString(refund.currency, "refund currency"),
        gatewayStatus: requireString(refund.status, "refund status"),
        reason,
        raw: body,
      };
    }

    return {
      kind: "unsupported",
      provider: "razorpay",
      eventId: input.eventId,
      eventType,
      raw: body,
    };
  }

  return {
    provider: "razorpay",
    publicKey: config.keyId,
    testMode: config.keyId.startsWith("rzp_test_"),
    async createOrder(input: CreateGatewayOrderInput): Promise<GatewayOrder> {
      const payload = await request<Record<string, unknown>>("/orders", {
        method: "POST",
        body: {
          amount: input.amountMinor,
          currency: input.currency,
          receipt: input.receipt,
          notes: input.notes,
        },
      });

      return {
        id: requireString(payload.id, "order id"),
        amountMinor: requireMinorUnits(payload.amount, "order amount"),
        currency: requireString(payload.currency, "order currency"),
        status: requireString(payload.status, "order status"),
        createdAt: optionalDate(payload.created_at),
      };
    },
    async fetchPayment(gatewayPaymentId: string): Promise<GatewayPayment> {
      const payload = await request<Record<string, unknown>>(
        `/payments/${encodeURIComponent(gatewayPaymentId)}`,
        { method: "GET" },
      );

      return {
        id: requireString(payload.id, "payment id"),
        orderId:
          typeof payload.order_id === "string" ? payload.order_id : null,
        amountMinor: requireMinorUnits(payload.amount, "payment amount"),
        currency: requireString(payload.currency, "payment currency"),
        status: requireString(payload.status, "payment status"),
        method: typeof payload.method === "string" ? payload.method : null,
        createdAt: optionalDate(payload.created_at),
      };
    },
    async createRefund(input: CreateGatewayRefundInput): Promise<GatewayRefund> {
      const payload = await request<Record<string, unknown>>(
        `/payments/${encodeURIComponent(input.gatewayPaymentId)}/refund`,
        {
          method: "POST",
          body: {
            amount: input.amountMinor,
            notes: input.notes,
          },
        },
      );

      return {
        id: requireString(payload.id, "refund id"),
        gatewayPaymentId: requireString(payload.payment_id, "payment id"),
        amountMinor: requireMinorUnits(payload.amount, "refund amount"),
        currency: requireString(payload.currency, "refund currency"),
        status: requireString(payload.status, "refund status"),
        createdAt: optionalDate(payload.created_at),
      };
    },
    verifyCheckoutSignature,
    verifyWebhookSignature,
    parseWebhookEvent,
  };
}
