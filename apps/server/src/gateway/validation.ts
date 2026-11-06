import { z } from "zod";

const nullableText = (max: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0 ? null : value,
    z.string().trim().max(max).nullable().optional(),
  );

export const verifyGatewayPaymentSchema = z
  .object({
    orderId: z.string().trim().min(1).max(160),
    gatewayPaymentId: z.string().trim().min(1).max(160),
    signature: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{64}$/i, "Enter a valid gateway signature."),
  })
  .strict();

export const cancelGatewayCheckoutSchema = z
  .object({
    orderId: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export const gatewayRefundSchema = z
  .object({
    amountMinor: z
      .number()
      .int("Refund amount must be a whole number of minor units.")
      .positive("Enter a refund amount greater than zero.")
      .max(999_999_999, "Refund amount is too large.")
      .optional(),
    reason: nullableText(500),
  })
  .strict();

export type VerifyGatewayPaymentPayload = z.infer<
  typeof verifyGatewayPaymentSchema
>;
export type GatewayRefundPayload = z.infer<typeof gatewayRefundSchema>;
