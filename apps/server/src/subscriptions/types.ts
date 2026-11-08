import type {
  BillingInterval,
  SortDirection,
  SubscriptionActivityType,
  SubscriptionSortField,
  SubscriptionStatus,
  SubscriptionStatusFilter,
} from "@subscript/shared";

export interface SubscriptionRecord {
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
  unitAmountMinor: number;
  currency: string;
  interval: BillingInterval;
  trialDays: number;
  startedAt: Date;
  trialEndsAt: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  pausedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionActivityRecord {
  id: string;
  type: SubscriptionActivityType;
  message: string;
  actorName: string | null;
  createdAt: Date;
}

export interface SubscriptionActivityInput {
  type: SubscriptionActivityType;
  message: string;
  actorId: string | null;
  actorName: string | null;
}

export interface CreateSubscriptionInput {
  organizationId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  planId: string;
  planName: string;
  planCode: string;
  quantity: number;
  unitAmountMinor: number;
  currency: string;
  interval: BillingInterval;
  trialDays: number;
  status: SubscriptionStatus;
  startedAt: Date;
  trialEndsAt: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  canceledAt: Date | null;
  activity: SubscriptionActivityInput;
  trialActivity: SubscriptionActivityInput | null;
}

export interface SubscriptionListOptions {
  search: string | null;
  status: SubscriptionStatusFilter;
  sort: SubscriptionSortField;
  direction: SortDirection;
  page: number;
  pageSize: number;
}

export interface SubscriptionListResult {
  items: SubscriptionRecord[];
  total: number;
}

export interface SubscriptionLifecycleChange {
  expectedStatus: SubscriptionStatus;
  expectedPeriodEnd: Date;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  pausedAt: Date | null;
  endedAt: Date | null;
  activity: SubscriptionActivityInput;
}

export interface SubscriptionStore {
  list(
    organizationId: string,
    options: SubscriptionListOptions,
  ): Promise<SubscriptionListResult>;
  findById(
    organizationId: string,
    subscriptionId: string,
  ): Promise<SubscriptionRecord | null>;
  create(input: CreateSubscriptionInput): Promise<SubscriptionRecord>;
  listUpcomingRenewals(
    organizationId: string,
    from: Date,
    until: Date,
    limit: number,
  ): Promise<SubscriptionRecord[]>;
  applyLifecycleChange(
    organizationId: string,
    subscriptionId: string,
    change: SubscriptionLifecycleChange,
  ): Promise<SubscriptionRecord>;
  listActivities(
    organizationId: string,
    subscriptionId: string,
    limit: number,
  ): Promise<SubscriptionActivityRecord[]>;
}
