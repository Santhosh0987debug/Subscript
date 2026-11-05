import type {
  IsoDateString,
  Payment,
  Subscription,
  SubscriptionActivity,
  InvoiceSummary,
  SubscriptionStatus,
} from "../domain/subscription.js";
import type { SortDirection } from "./customers.js";

export const SUBSCRIPTION_STATUS_FILTERS = [
  "ALL",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "PAUSED",
  "CANCELED",
  "EXPIRED",
] as const;
export type SubscriptionStatusFilter =
  (typeof SUBSCRIPTION_STATUS_FILTERS)[number];

export const SUBSCRIPTION_SORT_FIELDS = [
  "customer",
  "plan",
  "status",
  "nextBillingDate",
  "createdAt",
] as const;
export type SubscriptionSortField = (typeof SUBSCRIPTION_SORT_FIELDS)[number];

export interface CreateSubscriptionRequest {
  customerId: string;
  planId: string;
  /** Calendar date in YYYY-MM-DD form. */
  startDate: IsoDateString;
  /** Overrides the plan trial length when supplied. */
  trialDays?: number;
  quantity?: number;
  /**
   * Optional end of the first paid period. Omit it to derive the end from the
   * plan interval. Must be after the first paid period starts.
   */
  nextBillingDate?: IsoDateString | null;
}

export interface CancelSubscriptionRequest {
  /** Defaults to true: keep service until the current period ends. */
  atPeriodEnd?: boolean;
}

export interface SubscriptionListParams {
  query?: string;
  status?: SubscriptionStatusFilter;
  sort?: SubscriptionSortField;
  direction?: SortDirection;
  page?: number;
  pageSize?: number;
}

export interface SubscriptionListResponse {
  subscriptions: Subscription[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SubscriptionResponse {
  subscription: Subscription;
  activities: SubscriptionActivity[];
  invoices: InvoiceSummary[];
  payments: Payment[];
}

export interface SubscriptionMutationResponse {
  subscription: Subscription;
}

export function isSubscriptionStatus(
  value: string,
): value is SubscriptionStatus {
  return (SUBSCRIPTION_STATUS_FILTERS as readonly string[]).includes(value);
}
