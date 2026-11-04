import type {
  BillingAddress,
  CustomerActivityType,
  CustomerSortField,
  CustomerStatus,
  CustomerStatusFilter,
  SortDirection,
} from "@subscript/shared";

export interface CustomerRecord {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  billingAddress: BillingAddress;
  notes: string | null;
  status: CustomerStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerActivityRecord {
  id: string;
  type: CustomerActivityType;
  message: string;
  actorName: string | null;
  createdAt: Date;
}

export interface CustomerWriteFields {
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  billingAddress: BillingAddress;
  notes: string | null;
}

export interface CustomerListOptions {
  search: string | null;
  status: CustomerStatusFilter;
  sort: CustomerSortField;
  direction: SortDirection;
  page: number;
  pageSize: number;
}

export interface CustomerListResult {
  items: CustomerRecord[];
  total: number;
}

export interface CustomerActivityInput {
  message: string;
  actorId: string | null;
  actorName: string | null;
}

export interface CreateCustomerInput extends CustomerWriteFields {
  organizationId: string;
  activity: CustomerActivityInput;
}

export interface CustomerStatusChange {
  status: CustomerStatus;
  type: Extract<CustomerActivityType, "ARCHIVED" | "RESTORED">;
  activity: CustomerActivityInput;
}

export interface CustomerStore {
  list(
    organizationId: string,
    options: CustomerListOptions,
  ): Promise<CustomerListResult>;
  findById(
    organizationId: string,
    customerId: string,
  ): Promise<CustomerRecord | null>;
  findByEmail(
    organizationId: string,
    email: string,
    excludeCustomerId?: string,
  ): Promise<CustomerRecord | null>;
  create(input: CreateCustomerInput): Promise<CustomerRecord>;
  update(
    organizationId: string,
    customerId: string,
    fields: CustomerWriteFields,
    activity: CustomerActivityInput,
  ): Promise<CustomerRecord | null>;
  setStatus(
    organizationId: string,
    customerId: string,
    change: CustomerStatusChange,
  ): Promise<CustomerRecord | null>;
  listActivities(
    organizationId: string,
    customerId: string,
    limit: number,
  ): Promise<CustomerActivityRecord[]>;
}

export class CustomerEmailConflictError extends Error {
  constructor() {
    super("A customer with this email already exists.");
    this.name = "CustomerEmailConflictError";
  }
}
