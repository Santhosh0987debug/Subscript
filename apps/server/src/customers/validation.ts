import { z } from "zod";
import {
  CUSTOMER_SORT_FIELDS,
  CUSTOMER_STATUS_FILTERS,
  SORT_DIRECTIONS,
} from "@subscript/shared";

const nullableText = (max: number, label: string) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0 ? null : value,
    z
      .string()
      .trim()
      .max(max, `${label} must be ${max} characters or fewer.`)
      .nullable()
      .optional(),
  );

const billingAddressSchema = z
  .object({
    line1: z
      .string()
      .trim()
      .max(160, "Address line 1 must be 160 characters or fewer.")
      .default(""),
    line2: z
      .string()
      .trim()
      .max(160, "Address line 2 must be 160 characters or fewer.")
      .default(""),
    city: z
      .string()
      .trim()
      .max(100, "City must be 100 characters or fewer.")
      .default(""),
    region: z
      .string()
      .trim()
      .max(100, "Region must be 100 characters or fewer.")
      .default(""),
    postalCode: z
      .string()
      .trim()
      .max(40, "Postal code must be 40 characters or fewer.")
      .default(""),
    country: z
      .string()
      .trim()
      .max(80, "Country must be 80 characters or fewer.")
      .default(""),
  })
  .strict();

const nameSchema = z
  .string()
  .trim()
  .min(2, "Enter the customer's name.")
  .max(160, "Name must be 160 characters or fewer.");

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter an email address.")
  .max(320, "Email must be 320 characters or fewer.")
  .email("Enter a valid email address.");

export const createCustomerSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    phone: nullableText(40, "Phone"),
    company: nullableText(160, "Company"),
    billingAddress: billingAddressSchema.optional(),
    notes: nullableText(2000, "Notes"),
  })
  .strict();

export const updateCustomerSchema = z
  .object({
    name: nameSchema.optional(),
    email: emailSchema.optional(),
    phone: nullableText(40, "Phone"),
    company: nullableText(160, "Company"),
    billingAddress: billingAddressSchema.optional(),
    notes: nullableText(2000, "Notes"),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

export const customerListQuerySchema = z
  .object({
    query: z.string().trim().max(160).optional(),
    status: z.enum(CUSTOMER_STATUS_FILTERS).default("ACTIVE"),
    sort: z.enum(CUSTOMER_SORT_FIELDS).default("createdAt"),
    direction: z.enum(SORT_DIRECTIONS).default("desc"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
  })
  .strict();

export const customerIdParamsSchema = z.object({
  customerId: z.string().uuid("Choose a valid customer."),
});

export type CreateCustomerPayload = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerPayload = z.infer<typeof updateCustomerSchema>;
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
