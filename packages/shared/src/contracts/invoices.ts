import type {
  Invoice,
  InvoiceSummary,
  InvoiceStatus,
  Payment,
  PaymentMethod,
} from "../domain/subscription.js";
import type { SortDirection } from "./customers.js";

export const INVOICE_STATUS_FILTERS = [
  "ALL",
  "DRAFT",
  "OPEN",
  "PAID",
  "VOID",
  "UNCOLLECTIBLE",
] as const;
export type InvoiceStatusFilter = (typeof INVOICE_STATUS_FILTERS)[number];

export const INVOICE_SORT_FIELDS = [
  "number",
  "customer",
  "status",
  "total",
  "dueAt",
  "createdAt",
] as const;
export type InvoiceSortField = (typeof INVOICE_SORT_FIELDS)[number];

export const RECORDABLE_PAYMENT_STATUSES = ["PENDING", "SUCCEEDED"] as const;
export type RecordablePaymentStatus =
  (typeof RECORDABLE_PAYMENT_STATUSES)[number];

export interface GenerateInvoiceRequest {
  /** Tax rate in basis points, for example 825 for 8.25%. */
  taxRateBps: number;
  /** Days between issuing the invoice and its due date. Defaults to 7. */
  dueInDays?: number;
  /** Overrides the generated line-item description. */
  description?: string | null;
}

export interface GenerateInvoiceResponse {
  invoice: Invoice;
  /** False when an invoice already existed for this subscription period. */
  created: boolean;
}

export interface InvoiceListParams {
  query?: string;
  status?: InvoiceStatusFilter;
  subscriptionId?: string;
  customerId?: string;
  sort?: InvoiceSortField;
  direction?: SortDirection;
  page?: number;
  pageSize?: number;
}

export interface InvoiceListResponse {
  invoices: InvoiceSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface InvoiceResponse {
  invoice: Invoice;
}

export interface RecordPaymentRequest {
  amountMinor: number;
  method: PaymentMethod;
  reference?: string | null;
  note?: string | null;
  /**
   * The operator's intent. `SUCCEEDED` applies the payment immediately;
   * `PENDING` records an attempt that must be confirmed later. Other statuses
   * are rejected by validation.
   */
  status?: RecordablePaymentStatus;
}

export interface PaymentActionResponse {
  payment: Payment;
  invoice: Invoice;
}

export function isInvoiceStatus(value: string): value is InvoiceStatus {
  return (INVOICE_STATUS_FILTERS as readonly string[]).includes(value);
}
