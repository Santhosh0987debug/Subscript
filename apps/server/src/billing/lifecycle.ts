import type {
  InvoiceStatus,
  PaymentStatus,
  SubscriptionActivityType,
  SubscriptionStatus,
} from "@subscript/shared";
import {
  InvalidSubscriptionTransitionError,
  PaymentStateConflictError,
  InvoiceStateConflictError,
} from "./errors.js";

export const SUBSCRIPTION_ACTIONS = [
  "pause",
  "resume",
  "cancel",
  "renew",
  "expire",
  "markPastDue",
  "activate",
] as const;
export type SubscriptionAction = (typeof SUBSCRIPTION_ACTIONS)[number];

export interface SubscriptionTransitionInput {
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  action: SubscriptionAction;
  /** For cancel: true keeps service until the current period ends. */
  atPeriodEnd?: boolean;
  /**
   * Internal automation may end a cancellation that is already scheduled for
   * period end. User-facing calls never set this, so double-scheduling is still
   * rejected.
   */
  force?: boolean;
}

export interface SubscriptionTransition {
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  /** True when a renewal should advance the current billing period. */
  advancePeriod: boolean;
  activityType: SubscriptionActivityType;
}

const actionLabels: Record<SubscriptionAction, string> = {
  pause: "pause",
  resume: "resume",
  cancel: "cancel",
  renew: "renew",
  expire: "expire",
  markPastDue: "mark past due",
  activate: "activate",
};

function invalid(
  status: SubscriptionStatus,
  action: SubscriptionAction,
  detail?: string,
): never {
  throw new InvalidSubscriptionTransitionError(
    detail ??
      `A ${status} subscription cannot ${actionLabels[action]}.`,
  );
}

/**
 * The single subscription transition table. States not listed for an action
 * are rejected, which keeps HTTP, service and test behaviour aligned.
 */
export function resolveSubscriptionTransition(
  input: SubscriptionTransitionInput,
): SubscriptionTransition {
  const { status, action } = input;

  switch (action) {
    case "pause":
      if (status !== "ACTIVE") {
        invalid(status, action);
      }

      return {
        status: "PAUSED",
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        advancePeriod: false,
        activityType: "PAUSED",
      };

    case "resume":
      if (status !== "PAUSED") {
        invalid(status, action);
      }

      return {
        status: "ACTIVE",
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        advancePeriod: false,
        activityType: "RESUMED",
      };

    case "markPastDue":
      if (status !== "ACTIVE" && status !== "TRIALING") {
        invalid(status, action);
      }

      return {
        status: "PAST_DUE",
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        advancePeriod: false,
        activityType: "PAST_DUE",
      };

    case "activate":
      if (status !== "PAST_DUE") {
        invalid(status, action);
      }

      return {
        status: "ACTIVE",
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        advancePeriod: false,
        activityType: "ACTIVATED",
      };

    case "cancel": {
      const atPeriodEnd = input.atPeriodEnd ?? true;

      if (status === "CANCELED" || status === "EXPIRED") {
        invalid(status, action);
      }

      if (input.cancelAtPeriodEnd && !input.force) {
        invalid(
          status,
          action,
          "Cancellation is already scheduled for the end of this billing period.",
        );
      }

      if (atPeriodEnd) {
        if (status === "PAUSED") {
          invalid(
            status,
            action,
            "Resume this subscription before scheduling cancellation at period end.",
          );
        }

        return {
          status,
          cancelAtPeriodEnd: true,
          advancePeriod: false,
          activityType: "CANCEL_SCHEDULED",
        };
      }

      return {
        status: "CANCELED",
        cancelAtPeriodEnd: false,
        advancePeriod: false,
        activityType: "CANCELED",
      };
    }

    case "renew":
      if (status === "TRIALING") {
        return {
          status: "ACTIVE",
          cancelAtPeriodEnd: input.cancelAtPeriodEnd,
          advancePeriod: false,
          activityType: "ACTIVATED",
        };
      }

      if (status === "ACTIVE" || status === "PAST_DUE") {
        if (input.cancelAtPeriodEnd) {
          return {
            status: "CANCELED",
            cancelAtPeriodEnd: false,
            advancePeriod: false,
            activityType: "CANCELED",
          };
        }

        return {
          status: "ACTIVE",
          cancelAtPeriodEnd: false,
          advancePeriod: true,
          activityType: "RENEWED",
        };
      }

      return invalid(status, action);

    case "expire":
      if (status === "EXPIRED") {
        invalid(
          status,
          action,
          "This subscription has already expired.",
        );
      }

      return {
        status: "EXPIRED",
        cancelAtPeriodEnd: false,
        advancePeriod: false,
        activityType: "EXPIRED",
      };
  }
}

/** Only live billing states may generate new invoices. */
export function canGenerateInvoice(status: SubscriptionStatus): boolean {
  return status === "TRIALING" || status === "ACTIVE" || status === "PAST_DUE";
}

export const INVOICE_ACTIONS = [
  "issue",
  "void",
  "markUncollectible",
] as const;
export type InvoiceAction = (typeof INVOICE_ACTIONS)[number];

export interface InvoiceActionTransition {
  status: InvoiceStatus;
  activityType: "ISSUED" | "VOIDED" | "MARKED_UNCOLLECTIBLE";
}

export function resolveInvoiceAction(
  status: InvoiceStatus,
  action: InvoiceAction,
  amountPaidMinor: number,
): InvoiceActionTransition {
  switch (action) {
    case "issue":
      if (status !== "DRAFT") {
        throw new InvoiceStateConflictError(
          `Only draft invoices can be issued. This invoice is ${status}.`,
        );
      }

      return { status: "OPEN", activityType: "ISSUED" };

    case "void":
      if (status !== "DRAFT" && status !== "OPEN") {
        throw new InvoiceStateConflictError(
          `Only draft or open invoices can be voided. This invoice is ${status}.`,
        );
      }

      if (amountPaidMinor > 0) {
        throw new InvoiceStateConflictError(
          "Invoices with recorded payments cannot be voided. Refund the payments first.",
        );
      }

      return { status: "VOID", activityType: "VOIDED" };

    case "markUncollectible":
      if (status !== "DRAFT" && status !== "OPEN") {
        throw new InvoiceStateConflictError(
          `Only draft or open invoices can be marked uncollectible. This invoice is ${status}.`,
        );
      }

      if (amountPaidMinor > 0) {
        throw new InvoiceStateConflictError(
          "Invoices with recorded payments cannot be marked uncollectible.",
        );
      }

      return { status: "UNCOLLECTIBLE", activityType: "MARKED_UNCOLLECTIBLE" };
  }
}

export const PAYMENT_ACTIONS = ["succeed", "fail", "refund"] as const;
export type PaymentAction = (typeof PAYMENT_ACTIONS)[number];

export function resolvePaymentTransition(
  status: PaymentStatus,
  action: PaymentAction,
): PaymentStatus {
  switch (action) {
    case "succeed":
      if (status !== "PENDING") {
        throw new PaymentStateConflictError(
          `Only pending payments can be marked succeeded. This payment is ${status}.`,
        );
      }

      return "SUCCEEDED";

    case "fail":
      if (status !== "PENDING") {
        throw new PaymentStateConflictError(
          `Only pending payments can be marked failed. This payment is ${status}.`,
        );
      }

      return "FAILED";

    case "refund":
      if (status !== "SUCCEEDED") {
        throw new PaymentStateConflictError(
          `Only succeeded payments can be refunded. This payment is ${status}.`,
        );
      }

      return "REFUNDED";
  }
}

/**
 * A successful payment either settles the invoice or leaves it open with a
 * smaller balance. A refund can reopen a previously paid invoice.
 */
export function invoiceStatusForBalance(
  totalMinor: number,
  amountPaidMinor: number,
): { status: Extract<InvoiceStatus, "OPEN" | "PAID">; paidAt: Date | null } {
  if (amountPaidMinor >= totalMinor) {
    return { status: "PAID", paidAt: new Date() };
  }

  return { status: "OPEN", paidAt: null };
}
