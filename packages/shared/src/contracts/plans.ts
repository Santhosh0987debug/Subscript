import type {
  BillingInterval,
  IsoDateString,
  Money,
  PlanStatus,
} from "../domain/subscription.js";
import type { SortDirection } from "./customers.js";

export const PLAN_STATUS_FILTERS = ["ALL", "ACTIVE", "ARCHIVED"] as const;
export type PlanStatusFilter = (typeof PLAN_STATUS_FILTERS)[number];

export const PLAN_INTERVAL_FILTERS = ["ALL", "MONTH", "YEAR"] as const;
export type PlanIntervalFilter = (typeof PLAN_INTERVAL_FILTERS)[number];

export const PLAN_SORT_FIELDS = [
  "name",
  "price",
  "interval",
  "trialDays",
  "status",
  "createdAt",
  "updatedAt",
] as const;
export type PlanSortField = (typeof PLAN_SORT_FIELDS)[number];

export interface Plan {
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
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface CreatePlanRequest {
  name: string;
  description: string | null;
  price: Money;
  interval: BillingInterval;
  trialDays: number;
}

export interface UpdatePlanRequest {
  name?: string;
  description?: string | null;
  price?: Money;
  interval?: BillingInterval;
  trialDays?: number;
}

export interface PlanListParams {
  query?: string;
  status?: PlanStatusFilter;
  interval?: PlanIntervalFilter;
  sort?: PlanSortField;
  direction?: SortDirection;
  page?: number;
  pageSize?: number;
}

export interface PlanListResponse {
  plans: Plan[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PlanResponse {
  plan: Plan;
}
