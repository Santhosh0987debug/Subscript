import { AppError } from "../errors/app-error.js";

/**
 * Expected billing-domain conflicts. Routers translate these into 409
 * responses while unknown errors continue to become 500s.
 */
export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidSubscriptionTransitionError extends BillingError {
  constructor(message: string) {
    super(message);
  }
}

export class SubscriptionStateConflictError extends BillingError {
  constructor(message = "The subscription changed while this action was being applied. Refresh and try again.") {
    super(message);
  }
}

export class InvoiceStateConflictError extends BillingError {
  constructor(message: string) {
    super(message);
  }
}

export class PaymentStateConflictError extends BillingError {
  constructor(message: string) {
    super(message);
  }
}

export class OverpaymentError extends BillingError {
  constructor(message = "This payment would exceed the outstanding invoice balance.") {
    super(message);
  }
}

export class UnsupportedInvoiceOperationError extends BillingError {
  constructor(message: string) {
    super(message);
  }
}

/** Converts an expected billing conflict into the shared API envelope. */
export async function withBillingConflict<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof BillingError) {
      throw new AppError(409, "CONFLICT", error.message);
    }

    throw error;
  }
}
