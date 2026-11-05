/**
 * Domain contracts for the subscription platform.
 *
 * Money is represented in integer minor units (for example, cents) to avoid
 * floating-point drift at API boundaries. Dates are ISO 8601 strings.
 */
export type IsoDateString = string;
export type CurrencyCode = string;

export const BILLING_INTERVALS = ["MONTH", "YEAR"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const SUBSCRIPTION_STATUSES = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "PAUSED",
  "CANCELED",
  "EXPIRED",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_ACTIVITY_TYPES = [
  "CREATED",
  "TRIAL_STARTED",
  "ACTIVATED",
  "PAST_DUE",
  "PAUSED",
  "RESUMED",
  "CANCEL_SCHEDULED",
  "CANCELED",
  "RENEWED",
  "EXPIRED",
] as const;
export type SubscriptionActivityType =
  (typeof SUBSCRIPTION_ACTIVITY_TYPES)[number];

export const INVOICE_STATUSES = [
  "DRAFT",
  "OPEN",
  "PAID",
  "VOID",
  "UNCOLLECTIBLE",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_ACTIVITY_TYPES = [
  "CREATED",
  "ISSUED",
  "VOIDED",
  "MARKED_UNCOLLECTIBLE",
  "PAYMENT_RECORDED",
  "PAYMENT_SUCCEEDED",
  "PAYMENT_FAILED",
  "PAYMENT_REFUND_REQUESTED",
  "PAYMENT_REFUNDED",
  "PAYMENT_REFUND_FAILED",
] as const;
export type InvoiceActivityType = (typeof INVOICE_ACTIVITY_TYPES)[number];

export const PAYMENT_STATUSES = [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "REFUNDED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = [
  "CASH",
  "BANK_TRANSFER",
  "CARD",
  "CHECK",
  "OTHER",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Manual records are created by an operator inside Subscript. GATEWAY records
 * are created by a verified provider checkout or webhook.
 */
export const PAYMENT_SOURCES = ["MANUAL", "GATEWAY"] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export const PAYMENT_REFUND_STATUSES = [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
] as const;
export type PaymentRefundStatus = (typeof PAYMENT_REFUND_STATUSES)[number];

export const CUSTOMER_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const CUSTOMER_ACTIVITY_TYPES = [
  "CREATED",
  "UPDATED",
  "ARCHIVED",
  "RESTORED",
] as const;
export type CustomerActivityType = (typeof CUSTOMER_ACTIVITY_TYPES)[number];

export const PLAN_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

/**
 * A postal billing address. Empty strings represent fields that have not been
 * supplied; the API never exposes undefined address fields.
 */
export interface BillingAddress {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface CustomerSummary {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  status: CustomerStatus;
  createdAt: IsoDateString;
}

export interface PlanSummary {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  description: string | null;
  price: Money;
  interval: BillingInterval;
  trialDays: number;
  status: PlanStatus;
  subscriptionCount: number;
}

export interface Subscription {
  id: string;
  organizationId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  planId: string;
  planName: string;
  planCode: string;
  status: SubscriptionStatus;
  quantity: number;
  /** Unit price snapshotted when the subscription was created. */
  price: Money;
  interval: BillingInterval;
  trialDays: number;
  startedAt: IsoDateString;
  trialEndsAt: IsoDateString | null;
  currentPeriodStart: IsoDateString;
  currentPeriodEnd: IsoDateString;
  /** Trial end while trialing; otherwise the end of the current period. */
  nextBillingDate: IsoDateString;
  cancelAtPeriodEnd: boolean;
  canceledAt: IsoDateString | null;
  pausedAt: IsoDateString | null;
  endedAt: IsoDateString | null;
  outstanding: Money;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

/** Retained for API compatibility with the earlier placeholder contract. */
export type SubscriptionSummary = Subscription;

export interface SubscriptionActivity {
  id: string;
  type: SubscriptionActivityType;
  message: string;
  actorName: string | null;
  createdAt: IsoDateString;
}

export interface InvoiceSummary {
  id: string;
  organizationId: string;
  customerId: string;
  customerName: string;
  subscriptionId: string | null;
  number: string;
  status: InvoiceStatus;
  subtotal: Money;
  tax: Money;
  total: Money;
  amountPaid: Money;
  amountDue: Money;
  taxRateBps: number;
  periodStart: IsoDateString | null;
  periodEnd: IsoDateString | null;
  issuedAt: IsoDateString | null;
  dueAt: IsoDateString | null;
  paidAt: IsoDateString | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitAmountMinor: number;
  totalMinor: number;
}

export interface InvoiceActivity {
  id: string;
  type: InvoiceActivityType;
  message: string;
  actorName: string | null;
  createdAt: IsoDateString;
}

export interface InvoiceCustomerSnapshot {
  name: string;
  email: string;
  company: string;
  billingAddress: BillingAddress;
}

export interface PaymentGatewayDetails {
  /** Provider key such as `razorpay`. */
  provider: string;
  orderId: string | null;
  paymentId: string | null;
  /** The provider's latest status for this attempt. */
  status: string | null;
}

export interface PaymentRefund {
  id: string;
  paymentId: string;
  /** Provider key such as `razorpay`, or `manual` for an internal refund. */
  provider: string;
  providerRefundId: string | null;
  amount: Money;
  status: PaymentRefundStatus;
  reason: string | null;
  processedAt: IsoDateString | null;
  failedAt: IsoDateString | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface Payment {
  id: string;
  organizationId: string;
  invoiceId: string;
  invoiceNumber: string;
  subscriptionId: string | null;
  amount: Money;
  method: PaymentMethod;
  status: PaymentStatus;
  source: PaymentSource;
  reference: string | null;
  note: string | null;
  /** Present only for payments created through a payment gateway. */
  gateway: PaymentGatewayDetails | null;
  refundedAmount: Money;
  refunds: PaymentRefund[];
  paidAt: IsoDateString | null;
  failedAt: IsoDateString | null;
  refundedAt: IsoDateString | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface Invoice extends InvoiceSummary {
  customer: InvoiceCustomerSnapshot;
  lineItems: InvoiceLineItem[];
  activities: InvoiceActivity[];
  payments: Payment[];
}
