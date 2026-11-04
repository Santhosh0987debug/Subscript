import { z } from "zod";
import {
  BILLING_INTERVALS,
  PLAN_INTERVAL_FILTERS,
  PLAN_SORT_FIELDS,
  PLAN_STATUS_FILTERS,
  SORT_DIRECTIONS,
} from "@subscript/shared";

const nullableDescription = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? null : value,
  z
    .string()
    .trim()
    .max(1000, "Description must be 1,000 characters or fewer.")
    .nullable()
    .optional(),
);

const priceSchema = z
  .object({
    amountMinor: z
      .number()
      .int("Amount must be a whole number of minor units.")
      .min(0, "Amount cannot be negative.")
      .max(999_999_999, "Amount is too large."),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Use a three-letter currency code."),
  })
  .strict();

export const createPlanSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Enter a plan name.")
      .max(120, "Plan name must be 120 characters or fewer."),
    description: nullableDescription,
    price: priceSchema,
    interval: z.enum(BILLING_INTERVALS),
    trialDays: z
      .number()
      .int("Trial days must be a whole number.")
      .min(0, "Trial days cannot be negative.")
      .max(365, "Trial days must be 365 or fewer.")
      .default(0),
  })
  .strict();

export const updatePlanSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Enter a plan name.")
      .max(120, "Plan name must be 120 characters or fewer.")
      .optional(),
    description: nullableDescription,
    price: priceSchema.optional(),
    interval: z.enum(BILLING_INTERVALS).optional(),
    trialDays: z
      .number()
      .int("Trial days must be a whole number.")
      .min(0, "Trial days cannot be negative.")
      .max(365, "Trial days must be 365 or fewer.")
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

export const planListQuerySchema = z
  .object({
    query: z.string().trim().max(160).optional(),
    status: z.enum(PLAN_STATUS_FILTERS).default("ACTIVE"),
    interval: z.enum(PLAN_INTERVAL_FILTERS).default("ALL"),
    sort: z.enum(PLAN_SORT_FIELDS).default("createdAt"),
    direction: z.enum(SORT_DIRECTIONS).default("desc"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
  })
  .strict();

export const planIdParamsSchema = z.object({
  planId: z.string().uuid("Choose a valid plan."),
});

export type CreatePlanPayload = z.infer<typeof createPlanSchema>;
export type UpdatePlanPayload = z.infer<typeof updatePlanSchema>;
export type PlanListQuery = z.infer<typeof planListQuerySchema>;
