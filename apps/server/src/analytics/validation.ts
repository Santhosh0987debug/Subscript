import { z } from "zod";
import { ANALYTICS_GROUPINGS } from "@subscript/shared";

const optionalDate = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  z
    .string()
    .trim()
    .regex(
      /^\d{4}-\d{2}-\d{2}$/,
      "Use a real calendar date in YYYY-MM-DD form.",
    )
    .optional(),
);

const optionalTimeZone = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  z.string().trim().max(64, "Choose a valid IANA timezone.").optional(),
);

export const analyticsQuerySchema = z
  .object({
    from: optionalDate,
    to: optionalDate,
    timezone: optionalTimeZone,
    grouping: z.enum(ANALYTICS_GROUPINGS).default("month"),
  })
  .strict();

export const analyticsDetailQuerySchema = z
  .object({
    from: optionalDate,
    to: optionalDate,
    timezone: optionalTimeZone,
    grouping: z.enum(ANALYTICS_GROUPINGS).default("month"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
  })
  .strict();

export type AnalyticsQueryPayload = z.infer<typeof analyticsQuerySchema>;
export type AnalyticsDetailQueryPayload = z.infer<
  typeof analyticsDetailQuerySchema
>;
