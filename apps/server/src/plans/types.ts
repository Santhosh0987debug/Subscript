import type {
  BillingInterval,
  PlanStatus,
  PlanStatusFilter,
  PlanIntervalFilter,
  PlanSortField,
  SortDirection,
} from "@subscript/shared";

export interface PlanRecord {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  description: string | null;
  amountMinor: number;
  currency: string;
  interval: BillingInterval;
  trialDays: number;
  status: PlanStatus;
  subscriptionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanWriteFields {
  name: string;
  description: string | null;
  amountMinor: number;
  currency: string;
  interval: BillingInterval;
  trialDays: number;
}

export interface PlanListOptions {
  search: string | null;
  status: PlanStatusFilter;
  interval: PlanIntervalFilter;
  sort: PlanSortField;
  direction: SortDirection;
  page: number;
  pageSize: number;
}

export interface PlanListResult {
  items: PlanRecord[];
  total: number;
}

export interface CreatePlanInput extends PlanWriteFields {
  organizationId: string;
  code: string;
}

export interface PlanStore {
  list(
    organizationId: string,
    options: PlanListOptions,
  ): Promise<PlanListResult>;
  findById(organizationId: string, planId: string): Promise<PlanRecord | null>;
  findByCode(organizationId: string, code: string): Promise<PlanRecord | null>;
  create(input: CreatePlanInput): Promise<PlanRecord>;
  update(
    organizationId: string,
    planId: string,
    fields: PlanWriteFields,
  ): Promise<PlanRecord | null>;
  setStatus(
    organizationId: string,
    planId: string,
    status: PlanStatus,
  ): Promise<PlanRecord | null>;
  delete(organizationId: string, planId: string): Promise<boolean>;
  countSubscriptions(
    organizationId: string,
    planId: string,
  ): Promise<number>;
}

export class PlanCodeConflictError extends Error {
  constructor() {
    super("A plan with this code already exists.");
    this.name = "PlanCodeConflictError";
  }
}

export class PlanInUseError extends Error {
  constructor() {
    super("This plan is referenced by subscriptions.");
    this.name = "PlanInUseError";
  }
}
