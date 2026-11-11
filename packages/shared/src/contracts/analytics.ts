/**
 * Revenue analytics contracts shared by the API and the dashboard.
 *
 * All monetary amounts are integer minor units and are always grouped by
 * currency. Nothing in this module permits summing across currencies.
 * Percentages are expressed in basis points (1% = 100 bps) and are null when
 * the denominator is zero or the period does not contain enough data.
 */

export const ANALYTICS_GROUPINGS = ["day", "week", "month"] as const;
export type AnalyticsGrouping = (typeof ANALYTICS_GROUPINGS)[number];

export const ANALYTICS_AGING_BUCKETS = [
  "current",
  "1-30",
  "31-60",
  "61-90",
  "90+",
] as const;
export type AnalyticsAgingBucket = (typeof ANALYTICS_AGING_BUCKETS)[number];

export interface AnalyticsRange {
  /** Inclusive calendar start date in the reporting timezone (YYYY-MM-DD). */
  from: string;
  /** Inclusive calendar end date in the reporting timezone (YYYY-MM-DD). */
  to: string;
  /** Start of the range as an ISO instant (inclusive). */
  fromIso: string;
  /** End of the reporting day as an ISO instant (exclusive). */
  toIso: string;
  timezone: string;
  grouping: AnalyticsGrouping;
}

export interface CurrencyAmount {
  currency: string;
  amountMinor: number;
}

export interface AnalyticsPointRange {
  bucketStart: string;
  bucketEnd: string;
  label: string;
}

export interface AnalyticsRangeParams {
  from?: string;
  to?: string;
  timezone?: string;
  grouping?: AnalyticsGrouping;
}

export interface AnalyticsDetailParams extends AnalyticsRangeParams {
  page?: number;
  pageSize?: number;
}

export interface AnalyticsCurrencyRetention {
  currency: string;
  startingMrrMinor: number;
  churnedMrrMinor: number;
  expansionMrrMinor: number;
  /** Churned MRR / starting MRR. */
  revenueChurnRateBps: number | null;
  /** (Starting MRR - churned MRR) / starting MRR. */
  grossRevenueRetentionBps: number | null;
  /** (Starting MRR - churned MRR + expansion MRR) / starting MRR. */
  netRevenueRetentionBps: number | null;
}

export interface AnalyticsRetentionSummary {
  startingCustomers: number;
  churnedCustomers: number;
  customerChurnRateBps: number | null;
  startingSubscriptions: number;
  churnedSubscriptions: number;
  subscriptionRetentionBps: number | null;
  newCustomers: number;
  returningCustomers: number;
  byCurrency: AnalyticsCurrencyRetention[];
}

export interface AnalyticsOverviewCurrency {
  currency: string;
  mrrMinor: number;
  arrMinor: number;
  grossCollectedMinor: number;
  refundedMinor: number;
  netCollectedMinor: number;
  outstandingMinor: number;
  activeSubscriptions: number;
  activeCustomers: number;
  averageRevenuePerCustomerMinor: number | null;
  averageSubscriptionValueMinor: number | null;
  customerLifetimeValueMinor: number | null;
}

export interface AnalyticsOverviewResponse {
  range: AnalyticsRange;
  defaultCurrency: string;
  generatedAt: string;
  currencies: AnalyticsOverviewCurrency[];
  subscriptions: {
    /** Current organization-wide counts, independent of the range. */
    active: number;
    trialing: number;
    pastDue: number;
    paused: number;
    /** Subscriptions whose start date fell in the selected range. */
    newInRange: number;
    /** Subscriptions canceled or expired in the selected range. */
    canceledInRange: number;
    activeAtStart: number;
    activeAtEnd: number;
  };
  customers: {
    total: number;
    active: number;
    newInRange: number;
    returningInRange: number;
    churnedInRange: number;
  };
  retention: AnalyticsRetentionSummary;
}

export interface AnalyticsRevenuePointCurrency {
  currency: string;
  invoicedMinor: number;
  grossCollectedMinor: number;
  refundedMinor: number;
  netCollectedMinor: number;
  /**
   * Current balance of open invoices issued in this bucket. Historical
   * balances are not reconstructed because invoices do not store a balance
   * history.
   */
  outstandingMinor: number;
  newSubscriptions: number;
  canceledSubscriptions: number;
}

export interface AnalyticsRevenuePoint extends AnalyticsPointRange {
  currencies: AnalyticsRevenuePointCurrency[];
}

export interface AnalyticsRevenueResponse {
  range: AnalyticsRange;
  defaultCurrency: string;
  points: AnalyticsRevenuePoint[];
  totals: AnalyticsRevenuePointCurrency[];
}

export interface AnalyticsMrrPointCurrency {
  currency: string;
  mrrMinor: number;
  arrMinor: number;
  newMrrMinor: number;
  churnedMrrMinor: number;
  netNewMrrMinor: number;
}

export interface AnalyticsMrrPoint extends AnalyticsPointRange {
  activeSubscriptions: number;
  currencies: AnalyticsMrrPointCurrency[];
}

export interface AnalyticsMrrResponse {
  range: AnalyticsRange;
  defaultCurrency: string;
  points: AnalyticsMrrPoint[];
  latest: AnalyticsMrrPointCurrency[];
}

export interface AnalyticsSubscriptionGrowthPoint extends AnalyticsPointRange {
  newSubscriptions: number;
  canceledSubscriptions: number;
  netGrowth: number;
  startingSubscriptions: number;
  endingSubscriptions: number;
  growthRateBps: number | null;
  currencies: Array<{
    currency: string;
    newMrrMinor: number;
    churnedMrrMinor: number;
    netMrrMinor: number;
  }>;
}

export interface AnalyticsSubscriptionGrowthResponse {
  range: AnalyticsRange;
  defaultCurrency: string;
  points: AnalyticsSubscriptionGrowthPoint[];
  summary: {
    newSubscriptions: number;
    canceledSubscriptions: number;
    netGrowth: number;
    startingSubscriptions: number;
    endingSubscriptions: number;
    growthRateBps: number | null;
    churnRateBps: number | null;
  };
}

export interface AnalyticsChurnPoint extends AnalyticsPointRange {
  newCustomers: number;
  churnedCustomers: number;
  newSubscriptions: number;
  churnedSubscriptions: number;
  currencies: Array<{
    currency: string;
    newMrrMinor: number;
    churnedMrrMinor: number;
  }>;
}

export interface AnalyticsChurnResponse {
  range: AnalyticsRange;
  defaultCurrency: string;
  summary: AnalyticsRetentionSummary;
  points: AnalyticsChurnPoint[];
}

export interface AnalyticsCustomerRow {
  customerId: string;
  name: string;
  email: string;
  currency: string;
  netCollectedMinor: number;
  outstandingMinor: number;
  activeSubscriptions: number;
  firstSubscribedAt: string | null;
  lastPaymentAt: string | null;
}

export interface AnalyticsCustomerPoint extends AnalyticsPointRange {
  newCustomers: number;
  returningCustomers: number;
  churnedCustomers: number;
  activeCustomers: number;
}

export interface AnalyticsCustomersResponse {
  range: AnalyticsRange;
  defaultCurrency: string;
  summary: {
    totalCustomers: number;
    activeCustomers: number;
    newCustomers: number;
    returningCustomers: number;
    churnedCustomers: number;
    customerChurnRateBps: number | null;
    averageRevenuePerCustomer: CurrencyAmount[];
    customerLifetimeValue: CurrencyAmount[];
  };
  points: AnalyticsCustomerPoint[];
  topCustomers: {
    items: AnalyticsCustomerRow[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface AnalyticsPlanRow {
  planId: string;
  planName: string;
  planCode: string;
  interval: string;
  currency: string;
  activeSubscriptions: number;
  newSubscriptions: number;
  canceledSubscriptions: number;
  mrrMinor: number;
  arrMinor: number;
  netCollectedMinor: number;
  outstandingMinor: number;
  churnRateBps: number | null;
}

export interface AnalyticsPlansResponse {
  range: AnalyticsRange;
  defaultCurrency: string;
  items: AnalyticsPlanRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AnalyticsInvoiceCurrency {
  currency: string;
  invoicedMinor: number;
  /** Payments allocated to invoices issued in the range. */
  collectedMinor: number;
  /** Net cash received in the range, including payments on older invoices. */
  cashCollectedMinor: number;
  refundedMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
  uncollectibleMinor: number;
  collectionRateBps: number | null;
}

export interface AnalyticsInvoiceAgingRow {
  bucket: AnalyticsAgingBucket;
  currency: string;
  amountMinor: number;
}

export interface AnalyticsInvoicePointCurrency {
  currency: string;
  invoicedMinor: number;
  cashCollectedMinor: number;
  refundedMinor: number;
  outstandingMinor: number;
}

export interface AnalyticsInvoicePoint extends AnalyticsPointRange {
  currencies: AnalyticsInvoicePointCurrency[];
}

export interface AnalyticsInvoicesResponse {
  range: AnalyticsRange;
  defaultCurrency: string;
  currencies: AnalyticsInvoiceCurrency[];
  aging: AnalyticsInvoiceAgingRow[];
  points: AnalyticsInvoicePoint[];
}
