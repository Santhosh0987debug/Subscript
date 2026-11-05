import { z } from "zod";
import {
  SORT_DIRECTIONS,
  SUBSCRIPTION_SORT_FIELDS,
  SUBSCRIPTION_STATUS_FILTERS,
} from "@subscript/shared";

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a calendar date in YYYY-MM-DD form.");

export const createSubscriptionSchema = z
  .object({
    customerId: z.string().uuid("Choose a valid customer."),
    planId: z.string().uuid("Choose a valid plan."),
    startDate: isoDate,
    trialDays: z
      .number()
      .int("Trial days must be a whole number.")
      .min(0, "Trial days cannot be negative.")
      .max(365, "Trial days must be 365 or fewer.")
      .optional(),
    quantity: z
      .number()
      .int("Quantity must be a whole number.")
      .min(1, "Quantity must be at least 1.")
      .max(10_000, "Quantity is too large.")
      .default(1),
    nextBillingDate: isoDate.nullable().optional(),
  })
  .strict();

export const cancelSubscriptionSchema = z
  .object({
    atPeriodEnd: z.boolean().default(true),
  })
  .strict();

export const subscriptionListQuerySchema = z
  .object({
    query: z.string().trim().max(160).optional(),
    status: z.enum(SUBSCRIPTION_STATUS_FILTERS).default("ALL"),
    sort: z.enum(SUBSCRIPTION_SORT_FIELDS).default("createdAt"),
    direction: z.enum(SORT_DIRECTIONS).default("desc"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
  })
  .strict();

export const subscriptionIdParamsSchema = z.object({
  subscriptionId: z.string().uuid("Choose a valid subscription."),
});
