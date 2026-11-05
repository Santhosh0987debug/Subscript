import type {
  BillingAddress,
  InvoiceActivityType,
  InvoiceSortField,
  InvoiceStatus,
  InvoiceStatusFilter,
  PaymentMethod,
  PaymentSource,
  PaymentStatus,
  RecordablePaymentStatus,
  SortDirection,
} from "@subscript/shared";
import type { InvoiceAction, PaymentAction } from "../billing/lifecycle.js";

export interface BillingActor {
  actorId: string | null;
  actorName: string | null;
}

export interface InvoiceLineItemRecord {
  id: string;
  description: string;
  quantity: number;
  unitAmountMinor: number;
  totalMinor: number;
}

export interface InvoiceActivityRecord {
  id: string;
  type: InvoiceActivityType;
  message: string;
  actorName: string | null;
  createdAt: Date;
}

export interface PaymentRecord {
  id: string;
  organizationId: string;
  invoiceId: string;
  invoiceNumber: string;
  subscriptionId: string | null;
  amountMinor: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  source: PaymentSource;
  reference: string | null;
  note: string | null;
  paidAt: Date | null;
  failedAt: Date | null;
  refundedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceRecord {
  id: string;
  organizationId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerCompany: string | null;
  billingAddress: BillingAddress;
  subscriptionId: string | null;
  number: string;
  status: InvoiceStatus;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  taxRateBps: number;
  dueInDays: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  issuedAt: Date | null;
  dueAt: Date | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  uncollectibleAt: Date | null;
  lineItems: InvoiceLineItemRecord[];
  activities: InvoiceActivityRecord[];
  payments: PaymentRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceListOptions {
  search: string | null;
  status: InvoiceStatusFilter;
  subscriptionId: string | null;
  customerId: string | null;
  sort: InvoiceSortField;
  direction: SortDirection;
  page: number;
  pageSize: number;
}

export interface InvoiceListResult {
  items: InvoiceRecord[];
  total: number;
}

export interface GenerateInvoiceInput {
  organizationId: string;
  subscriptionId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerCompany: string | null;
  billingAddress: BillingAddress;
  periodStart: Date;
  periodEnd: Date;
  quantity: number;
  unitAmountMinor: number;
  currency: string;
  lineDescription: string;
  taxRateBps: number;
  dueInDays: number;
  actor: BillingActor;
}

export interface RecordPaymentInput {
  organizationId: string;
  invoiceId: string;
  amountMinor: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  status: RecordablePaymentStatus;
  actor: BillingActor;
}

export interface PaymentTransitionInput {
  organizationId: string;
  paymentId: string;
  action: PaymentAction;
  actor: BillingActor;
}

export interface PaymentMutationResult {
  payment: PaymentRecord;
  invoice: InvoiceRecord;
}

export interface InvoiceStore {
  list(
    organizationId: string,
    options: InvoiceListOptions,
  ): Promise<InvoiceListResult>;
  findById(
    organizationId: string,
    invoiceId: string,
  ): Promise<InvoiceRecord | null>;
  findPaymentById(
    organizationId: string,
    paymentId: string,
  ): Promise<PaymentRecord | null>;
  listBySubscription(
    organizationId: string,
    subscriptionId: string,
  ): Promise<InvoiceRecord[]>;
  generate(input: GenerateInvoiceInput): Promise<{
    invoice: InvoiceRecord;
    created: boolean;
  }>;
  applyAction(
    organizationId: string,
    invoiceId: string,
    action: InvoiceAction,
    actor: BillingActor,
  ): Promise<InvoiceRecord>;
  recordPayment(input: RecordPaymentInput): Promise<PaymentMutationResult>;
  transitionPayment(
    input: PaymentTransitionInput,
  ): Promise<PaymentMutationResult>;
  listPaymentsForSubscription(
    organizationId: string,
    subscriptionId: string,
  ): Promise<PaymentRecord[]>;
  sumOutstandingBySubscriptions(
    organizationId: string,
    subscriptionIds: readonly string[],
  ): Promise<Map<string, number>>;
}
