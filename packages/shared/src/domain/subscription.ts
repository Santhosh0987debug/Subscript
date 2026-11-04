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

export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
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
  price: Money;
  interval: BillingInterval;
  active: boolean;
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
