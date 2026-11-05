import { z } from "zod";
import {
  INVOICE_SORT_FIELDS,
  INVOICE_STATUS_FILTERS,
  PAYMENT_METHODS,
  RECORDABLE_PAYMENT_STATUSES,
  SORT_DIRECTIONS,
} from "@subscript/shared";

const nullableText = (max: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0 ? null : value,
    z.string().trim().max(max).nullable().optional(),
  );

export const generateInvoiceSchema = z
  .object({
    taxRateBps: z
      .number()
      .int("Tax rate must be a whole number of basis points.")
      .min(0, "Tax rate cannot be negative.")
      .max(10_000, "Tax rate cannot exceed 100%."),
    dueInDays: z
      .number()
      .int("Due days must be a whole number.")
      .min(0, "Due days cannot be negative.")
      .max(365, "Due days must be 365 or fewer.")
      .default(7),
    description: nullableText(300),
  })
  .strict();

export const invoiceListQuerySchema = z
  .object({
    query: z.string().trim().max(160).optional(),
    status: z.enum(INVOICE_STATUS_FILTERS).default("ALL"),
    subscriptionId: z.string().uuid("Choose a valid subscription.").optional(),
    customerId: z.string().uuid("Choose a valid customer.").optional(),
    sort: z.enum(INVOICE_SORT_FIELDS).default("createdAt"),
    direction: z.enum(SORT_DIRECTIONS).default("desc"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
  })
  .strict();

export const invoiceIdParamsSchema = z.object({
  invoiceId: z.string().uuid("Choose a valid invoice."),
});

export const invoicePaymentParamsSchema = z.object({
  invoiceId: z.string().uuid("Choose a valid invoice."),
});

export const paymentIdParamsSchema = z.object({
  paymentId: z.string().uuid("Choose a valid payment."),
});

export const recordPaymentSchema = z
  .object({
    amountMinor: z
      .number()
      .int("Amount must be a whole number of minor units.")
      .positive("Enter a payment amount greater than zero.")
      .max(999_999_999, "Amount is too large."),
    method: z.enum(PAYMENT_METHODS),
    reference: nullableText(160),
    note: nullableText(500),
    status: z.enum(RECORDABLE_PAYMENT_STATUSES).default("SUCCEEDED"),
  })
  .strict();

export type GenerateInvoicePayload = z.infer<typeof generateInvoiceSchema>;
export type RecordPaymentPayload = z.infer<typeof recordPaymentSchema>;
