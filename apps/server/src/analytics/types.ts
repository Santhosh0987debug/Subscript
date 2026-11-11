import type {
  AnalyticsChurnResponse,
  AnalyticsCustomerRow,
  AnalyticsCustomersResponse,
  AnalyticsInvoicesResponse,
  AnalyticsMrrResponse,
  AnalyticsOverviewResponse,
  AnalyticsPlanRow,
  AnalyticsPlansResponse,
  AnalyticsRevenuePointCurrency,
  AnalyticsRevenueResponse,
  AnalyticsSubscriptionGrowthResponse,
} from "@subscript/shared";
import type { ResolvedAnalyticsQuery } from "./range.js";

export interface AnalyticsPageRequest {
  page: number;
  pageSize: number;
}

export interface AnalyticsRevenueReportRow extends AnalyticsRevenuePointCurrency {
  bucketStart: string;
  bucketEnd: string;
  label: string;
}

export interface AnalyticsSubscriptionReportRow extends AnalyticsPlanRow {
  reportFrom: string;
  reportTo: string;
}

export interface AnalyticsCustomerPage {
  items: AnalyticsCustomerRow[];
  total: number;
}

/**
 * High-level analytics storage contract. The PostgreSQL implementation uses
 * aggregate SQL; the in-memory implementation exists for local development and
 * API tests that do not have a database.
 */
export interface AnalyticsStore {
  getDefaultCurrency(organizationId: string): Promise<string>;
  getOverview(
    organizationId: string,
    query: ResolvedAnalyticsQuery,
  ): Promise<AnalyticsOverviewResponse>;
  getRevenue(
    organizationId: string,
    query: ResolvedAnalyticsQuery,
  ): Promise<AnalyticsRevenueResponse>;
  getMrrHistory(
    organizationId: string,
    query: ResolvedAnalyticsQuery,
  ): Promise<AnalyticsMrrResponse>;
  getSubscriptionGrowth(
    organizationId: string,
    query: ResolvedAnalyticsQuery,
  ): Promise<AnalyticsSubscriptionGrowthResponse>;
  getChurn(
    organizationId: string,
    query: ResolvedAnalyticsQuery,
  ): Promise<AnalyticsChurnResponse>;
  getCustomers(
    organizationId: string,
    query: ResolvedAnalyticsQuery,
    page: AnalyticsPageRequest,
  ): Promise<AnalyticsCustomersResponse>;
  getPlans(
    organizationId: string,
    query: ResolvedAnalyticsQuery,
    page: AnalyticsPageRequest,
  ): Promise<AnalyticsPlansResponse>;
  getInvoices(
    organizationId: string,
    query: ResolvedAnalyticsQuery,
  ): Promise<AnalyticsInvoicesResponse>;
  getRevenueReportRows(
    organizationId: string,
    query: ResolvedAnalyticsQuery,
  ): Promise<AnalyticsRevenueReportRow[]>;
  getSubscriptionReportRows(
    organizationId: string,
    query: ResolvedAnalyticsQuery,
  ): Promise<AnalyticsSubscriptionReportRow[]>;
}
