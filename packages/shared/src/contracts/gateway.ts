import type {
  Invoice,
  Money,
  Payment,
  PaymentRefund,
} from "../domain/subscription.js";

/**
 * Public gateway capability information. Secrets are never part of this
 * response; the publishable key is delivered with a checkout session.
 */
export interface GatewayConfigResponse {
  provider: string;
  enabled: boolean;
  /** True when the configured provider key belongs to test mode. */
  testMode: boolean;
}

export interface GatewayCheckoutSession {
  provider: string;
  keyId: string;
  orderId: string;
  payment: Payment;
  invoiceNumber: string;
  amount: Money;
  customerName: string;
  customerEmail: string;
  description: string;
  testMode: boolean;
}

export interface VerifyGatewayPaymentRequest {
  /** Razorpay order id returned by the backend checkout session. */
  orderId: string;
  /** Razorpay payment id returned by Checkout. */
  gatewayPaymentId: string;
  /** Razorpay HMAC-SHA256 checkout signature. */
  signature: string;
}

export interface GatewayRefundRequest {
  /** Defaults to the remaining refundable amount when omitted. */
  amountMinor?: number;
  reason?: string | null;
}

export interface GatewayRefundResponse {
  payment: Payment;
  invoice: Invoice;
  refund: PaymentRefund;
}

export interface GatewayWebhookResponse {
  status: "processed" | "duplicate" | "ignored";
}
