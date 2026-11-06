import type {
  InvoiceStatus,
  Payment,
  PaymentMethod,
  PaymentRefundStatus,
  PaymentSource,
  PaymentStatus,
  SubscriptionActivityType,
  SubscriptionStatus,
  InvoiceActivityType,
  Subscription,
} from "@subscript/shared";

export type BillingBadgeTone =
  | "neutral"
  | "lime"
  | "dark"
  | "coral"
  | "outline";

export const subscriptionStatusLabels: Record<SubscriptionStatus, string> = {
  TRIALING: "Trialing",
  ACTIVE: "Active",
  PAST_DUE: "Past due",
  PAUSED: "Paused",
  CANCELED: "Canceled",
  EXPIRED: "Expired",
};

export const subscriptionStatusTones: Record<
  SubscriptionStatus,
  BillingBadgeTone
> = {
  TRIALING: "neutral",
  ACTIVE: "lime",
  PAST_DUE: "coral",
  PAUSED: "outline",
  CANCELED: "outline",
  EXPIRED: "outline",
};

export const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  PAID: "Paid",
  VOID: "Void",
  UNCOLLECTIBLE: "Uncollectible",
};

export const invoiceStatusTones: Record<InvoiceStatus, BillingBadgeTone> = {
  DRAFT: "neutral",
  OPEN: "lime",
  PAID: "dark",
  VOID: "outline",
  UNCOLLECTIBLE: "coral",
};

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  PENDING: "Pending",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  REFUNDED: "Refunded",
};

export const paymentStatusTones: Record<PaymentStatus, BillingBadgeTone> = {
  PENDING: "neutral",
  SUCCEEDED: "lime",
  FAILED: "coral",
  REFUNDED: "outline",
};

export const paymentRefundStatusLabels: Record<PaymentRefundStatus, string> = {
  PENDING: "Refund pending",
  SUCCEEDED: "Refunded",
  FAILED: "Refund failed",
};

export const paymentRefundStatusTones: Record<
  PaymentRefundStatus,
  BillingBadgeTone
> = {
  PENDING: "neutral",
  SUCCEEDED: "lime",
  FAILED: "coral",
};

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  CHECK: "Check",
  OTHER: "Other",
};

export const paymentSourceLabels: Record<PaymentSource, string> = {
  MANUAL: "Manual entry",
  GATEWAY: "Payment gateway",
};

export const subscriptionActivityLabels: Record<
  SubscriptionActivityType,
  string
> = {
  CREATED: "Created",
  TRIAL_STARTED: "Trial started",
  ACTIVATED: "Activated",
  PAST_DUE: "Past due",
  PAUSED: "Paused",
  RESUMED: "Resumed",
  CANCEL_SCHEDULED: "Cancellation scheduled",
  CANCELED: "Canceled",
  RENEWED: "Renewed",
  EXPIRED: "Expired",
};

export const invoiceActivityLabels: Record<InvoiceActivityType, string> = {
  CREATED: "Created",
  ISSUED: "Issued",
  VOIDED: "Voided",
  MARKED_UNCOLLECTIBLE: "Marked uncollectible",
  PAYMENT_RECORDED: "Payment recorded",
  PAYMENT_SUCCEEDED: "Payment succeeded",
  PAYMENT_FAILED: "Payment failed",
  PAYMENT_REFUND_REQUESTED: "Refund requested",
  PAYMENT_REFUNDED: "Payment refunded",
  PAYMENT_REFUND_FAILED: "Refund failed",
};

const billingDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const activityTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatBillingDate(value: string | null): string {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return billingDateFormatter.format(date);
}

export function formatActivityTime(value: string | null): string {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return activityTimeFormatter.format(date);
}

export function formatBillingPeriod(
  start: string | null,
  end: string | null,
): string {
  if (!start && !end) {
    return "No billing period";
  }

  return `${formatBillingDate(start)} - ${formatBillingDate(end)}`;
}

export function formatTaxRateBps(taxRateBps: number): string {
  const percent = taxRateBps / 100;
  return `${percent.toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function getTodayDateInputValue(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function getNextBillingSummary(subscription: Subscription): {
  label: string;
  date: string;
} {
  if (subscription.status === "TRIALING") {
    return {
      label: "Trial ends",
      date: formatBillingDate(subscription.trialEndsAt),
    };
  }

  if (
    subscription.status === "CANCELED" ||
    subscription.status === "EXPIRED"
  ) {
    return {
      label: "Ended",
      date: formatBillingDate(
        subscription.endedAt ?? subscription.currentPeriodEnd,
      ),
    };
  }

  if (subscription.status === "PAUSED") {
    return {
      label: "Billing paused",
      date: formatBillingDate(subscription.currentPeriodEnd),
    };
  }

  return {
    label: "Next billing",
    date: formatBillingDate(subscription.nextBillingDate),
  };
}

export interface SubscriptionActionAvailability {
  pause: boolean;
  resume: boolean;
  renew: boolean;
  cancelAtPeriodEnd: boolean;
  cancelImmediately: boolean;
  expire: boolean;
  markPastDue: boolean;
  generateInvoice: boolean;
}

export function getSubscriptionActionAvailability(
  status: SubscriptionStatus,
  cancelAtPeriodEnd: boolean,
): SubscriptionActionAvailability {
  const live =
    status === "TRIALING" || status === "ACTIVE" || status === "PAST_DUE";
  const canCancel = !cancelAtPeriodEnd && (live || status === "PAUSED");

  return {
    pause: status === "ACTIVE",
    resume: status === "PAUSED",
    renew: live,
    cancelAtPeriodEnd: canCancel && status !== "PAUSED",
    cancelImmediately: canCancel,
    expire: status !== "EXPIRED",
    markPastDue: status === "TRIALING" || status === "ACTIVE",
    generateInvoice: live,
  };
}

export interface InvoiceActionAvailability {
  issue: boolean;
  void: boolean;
  markUncollectible: boolean;
}

export function getInvoiceActionAvailability(
  status: InvoiceStatus,
  amountPaidMinor: number,
): InvoiceActionAvailability {
  const editable = status === "DRAFT" || status === "OPEN";
  const withoutPayments = amountPaidMinor === 0;

  return {
    issue: status === "DRAFT",
    void: editable && withoutPayments,
    markUncollectible: editable && withoutPayments,
  };
}

export interface PaymentActionAvailability {
  succeed: boolean;
  fail: boolean;
  refund: boolean;
}

export function getPaymentActionAvailability(
  status: PaymentStatus,
): PaymentActionAvailability {
  return {
    succeed: status === "PENDING",
    fail: status === "PENDING",
    refund: status === "SUCCEEDED",
  };
}

/**
 * Remaining amount a gateway payment can refund, excluding refunds that are
 * still pending confirmation from the provider.
 */
export function getGatewayRefundableMinor(payment: Payment): number {
  if (
    payment.source !== "GATEWAY" ||
    (payment.status !== "SUCCEEDED" && payment.status !== "REFUNDED")
  ) {
    return 0;
  }

  const pendingMinor = payment.refunds
    .filter((refund) => refund.status === "PENDING")
    .reduce((total, refund) => total + refund.amount.amountMinor, 0);

  return Math.max(
    payment.amount.amountMinor -
      payment.refundedAmount.amountMinor -
      pendingMinor,
    0,
  );
}
