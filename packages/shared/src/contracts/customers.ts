import type {
  BillingAddress,
  CustomerActivityType,
  CustomerStatus,
  IsoDateString,
} from "../domain/subscription.js";

export const CUSTOMER_STATUS_FILTERS = [
  "ALL",
  "ACTIVE",
  "ARCHIVED",
] as const;
export type CustomerStatusFilter = (typeof CUSTOMER_STATUS_FILTERS)[number];

export const CUSTOMER_SORT_FIELDS = [
  "name",
  "email",
  "company",
  "status",
  "createdAt",
  "updatedAt",
] as const;
export type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export interface Customer {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  billingAddress: BillingAddress;
  notes: string;
  status: CustomerStatus;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface CustomerActivity {
  id: string;
  type: CustomerActivityType;
  message: string;
  actorName: string | null;
  createdAt: IsoDateString;
}

export interface CreateCustomerRequest {
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  billingAddress: BillingAddress;
  notes: string | null;
}

export interface UpdateCustomerRequest {
  name?: string;
  email?: string;
  phone?: string | null;
  company?: string | null;
  billingAddress?: BillingAddress;
  notes?: string | null;
}

export interface CustomerListParams {
  query?: string;
  status?: CustomerStatusFilter;
  sort?: CustomerSortField;
  direction?: SortDirection;
  page?: number;
  pageSize?: number;
}

export interface CustomerListResponse {
  customers: Customer[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CustomerResponse {
  customer: Customer;
  activities: CustomerActivity[];
}

export interface CustomerMutationResponse {
  customer: Customer;
}
