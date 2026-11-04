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
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const INVOICE_STATUSES = [
  "DRAFT",
  "OPEN",
  "PAID",
  "VOID",
  "UNCOLLECTIBLE",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

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

export interface SubscriptionSummary {
  id: string;
  organizationId: string;
  customerId: string;
  planId: string;
  status: SubscriptionStatus;
  quantity: number;
  currentPeriodEnd: IsoDateString | null;
  cancelAtPeriodEnd: boolean;
}

export interface InvoiceSummary {
  id: string;
  organizationId: string;
  customerId: string;
  number: string;
  status: InvoiceStatus;
  total: Money;
  dueAt: IsoDateString;
  paidAt: IsoDateString | null;
}
