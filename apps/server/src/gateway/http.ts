import { AppError } from "../errors/app-error.js";
import { BillingError } from "../billing/errors.js";
import {
  GatewayConfigurationError,
  GatewayPayloadError,
  GatewayRequestError,
  GatewaySignatureError,
  GatewayWebhookInProgressError,
} from "./errors.js";

export async function withGatewayErrors<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof BillingError) {
      throw new AppError(409, "CONFLICT", error.message);
    }

    if (error instanceof GatewaySignatureError) {
      throw new AppError(400, "BAD_REQUEST", error.message);
    }

    if (error instanceof GatewayPayloadError) {
      throw new AppError(400, "BAD_REQUEST", error.message);
    }

    if (error instanceof GatewayWebhookInProgressError) {
      throw new AppError(409, "CONFLICT", error.message);
    }

    if (error instanceof GatewayConfigurationError) {
      throw new AppError(503, "SERVICE_UNAVAILABLE", error.message);
    }

    if (error instanceof GatewayRequestError) {
      throw new AppError(502, "BAD_GATEWAY", error.message);
    }

    throw error;
  }
}
