/**
 * Provider-independent payment gateway contracts.
 *
 * The billing engine only sees normalized orders, payments, refunds and
 * webhook events. Provider-specific authentication, payload shapes and
 * signature algorithms stay inside the adapter that implements this
 * interface.
 */
export const GATEWAY_WEBHOOK_EVENT_TYPES = [
  "payment.captured",
  "payment.failed",
  "order.paid",
  "refund.created",
  "refund.processed",
  "refund.failed",
] as const;
export type GatewayWebhookEventType =
  (typeof GATEWAY_WEBHOOK_EVENT_TYPES)[number];

export interface CreateGatewayOrderInput {
  amountMinor: number;
  currency: string;
  /** Short internal reference shown by the provider. */
  receipt: string;
  notes: Record<string, string>;
}

export interface GatewayOrder {
  id: string;
  amountMinor: number;
  currency: string;
  status: string;
  createdAt: Date | null;
}

export interface GatewayPayment {
  id: string;
  orderId: string | null;
  amountMinor: number;
  currency: string;
  status: string;
  method: string | null;
  createdAt: Date | null;
}

export interface CreateGatewayRefundInput {
  gatewayPaymentId: string;
  amountMinor: number;
  currency: string;
  notes: Record<string, string>;
}

export interface GatewayRefund {
  id: string;
  gatewayPaymentId: string;
  amountMinor: number;
  currency: string;
  status: string;
  createdAt: Date | null;
}

export interface VerifyGatewayPaymentSignatureInput {
  orderId: string;
  gatewayPaymentId: string;
  signature: string;
}

export interface NormalizedGatewayPaymentEvent {
  kind: "payment";
  provider: string;
  eventId: string;
  eventType: Extract<
    GatewayWebhookEventType,
    "payment.captured" | "payment.failed" | "order.paid"
  >;
  createdAt: Date | null;
  gatewayOrderId: string | null;
  gatewayPaymentId: string;
  /** Set when the provider echoes our internal payment id in notes. */
  internalPaymentId: string | null;
  amountMinor: number;
  currency: string;
  gatewayStatus: string;
  raw: unknown;
}

export interface NormalizedGatewayRefundEvent {
  kind: "refund";
  provider: string;
  eventId: string;
  eventType: Extract<
    GatewayWebhookEventType,
    "refund.created" | "refund.processed" | "refund.failed"
  >;
  createdAt: Date | null;
  gatewayRefundId: string;
  gatewayPaymentId: string;
  /** Set when the provider echoes our internal refund id in notes. */
  internalRefundId: string | null;
  amountMinor: number;
  currency: string;
  gatewayStatus: string;
  reason: string | null;
  raw: unknown;
}

export interface UnsupportedGatewayWebhookEvent {
  kind: "unsupported";
  provider: string;
  eventId: string;
  eventType: string;
  raw: unknown;
}

export type NormalizedGatewayWebhookEvent =
  | NormalizedGatewayPaymentEvent
  | NormalizedGatewayRefundEvent
  | UnsupportedGatewayWebhookEvent;

export interface PaymentGateway {
  readonly provider: string;
  /** Publishable key delivered to Checkout; never the secret. */
  readonly publicKey: string;
  readonly testMode: boolean;
  createOrder(input: CreateGatewayOrderInput): Promise<GatewayOrder>;
  fetchPayment(gatewayPaymentId: string): Promise<GatewayPayment>;
  createRefund(input: CreateGatewayRefundInput): Promise<GatewayRefund>;
  verifyCheckoutSignature(
    input: VerifyGatewayPaymentSignatureInput,
  ): boolean;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
  parseWebhookEvent(input: {
    rawBody: Buffer;
    eventId: string;
  }): NormalizedGatewayWebhookEvent;
}
