import type { BillingInterval, CurrencyAmount } from "@subscript/shared";
import type { InvoiceRecord, PaymentRecord } from "../invoices/types.js";
import type { SubscriptionRecord } from "../subscriptions/types.js";

export function normalizeMrrMinor(
  unitAmountMinor: number,
  quantity: number,
  interval: BillingInterval,
): number {
  const periodic = unitAmountMinor * quantity;

  return interval === "YEAR" ? Math.round(periodic / 12) : periodic;
}

export function subscriptionRevenueStart(
  subscription: SubscriptionRecord,
): Date {
  const trialEnd = subscription.trialEndsAt;

  if (!trialEnd) {
    return subscription.startedAt;
  }

  return trialEnd.getTime() > subscription.startedAt.getTime()
    ? trialEnd
    : subscription.startedAt;
}

export function subscriptionRevenueEnd(
  subscription: SubscriptionRecord,
): Date | null {
  const candidates: Date[] = [];

  if (subscription.endedAt) {
    candidates.push(subscription.endedAt);
  }

  if (subscription.canceledAt) {
    candidates.push(subscription.canceledAt);
  }

  if (subscription.status === "PAUSED" && subscription.pausedAt) {
    candidates.push(subscription.pausedAt);
  }

  if (candidates.length === 0) {
    return null;
  }

  return new Date(Math.min(...candidates.map((date) => date.getTime())));
}

export function subscriptionAccessEnd(
  subscription: SubscriptionRecord,
): Date | null {
  const candidates = [subscription.endedAt, subscription.canceledAt].filter(
    (date): date is Date => date !== null,
  );

  if (candidates.length === 0) {
    return null;
  }

  return new Date(Math.min(...candidates.map((date) => date.getTime())));
}

export function isRevenueActiveAt(
  subscription: SubscriptionRecord,
  instant: Date,
): boolean {
  const start = subscriptionRevenueStart(subscription);
  const end = subscriptionRevenueEnd(subscription);

  return (
    start.getTime() <= instant.getTime() &&
    (end === null || end.getTime() > instant.getTime())
  );
}

export function isAccessActiveAt(
  subscription: SubscriptionRecord,
  instant: Date,
): boolean {
  const end = subscriptionAccessEnd(subscription);

  return (
    subscription.startedAt.getTime() <= instant.getTime() &&
    (end === null || end.getTime() > instant.getTime())
  );
}

export function isWithin(
  date: Date | null,
  from: Date,
  toExclusive: Date,
): boolean {
  return (
    date !== null &&
    date.getTime() >= from.getTime() &&
    date.getTime() < toExclusive.getTime()
  );
}

export function isChurnedSubscription(
  subscription: SubscriptionRecord,
  from: Date,
  toExclusive: Date,
): boolean {
  if (subscription.status !== "CANCELED" && subscription.status !== "EXPIRED") {
    return false;
  }

  return isWithin(subscriptionAccessEnd(subscription), from, toExclusive);
}

export function percentageBps(
  numerator: number,
  denominator: number,
): number | null {
  if (denominator <= 0) {
    return null;
  }

  return Math.round((numerator / denominator) * 10_000);
}

export function addToCurrency(
  map: Map<string, number>,
  currency: string,
  amount: number,
): void {
  map.set(currency, (map.get(currency) ?? 0) + amount);
}

export function currencyAmounts(
  map: ReadonlyMap<string, number>,
  defaultCurrency: string,
): CurrencyAmount[] {
  const currencies = [...map.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([currency, amountMinor]) => ({ currency, amountMinor }));

  return sortCurrencyAmounts(currencies, defaultCurrency);
}

export function sortCurrencyAmounts(
  amounts: readonly CurrencyAmount[],
  defaultCurrency: string,
): CurrencyAmount[] {
  return [...amounts].sort((left, right) => {
    if (left.currency === right.currency) {
      return 0;
    }

    if (left.currency === defaultCurrency) {
      return -1;
    }

    if (right.currency === defaultCurrency) {
      return 1;
    }

    return left.currency.localeCompare(right.currency);
  });
}

export function sumCurrencyAmounts(
  amounts: readonly CurrencyAmount[],
): CurrencyAmount[] {
  const map = new Map<string, number>();

  for (const amount of amounts) {
    addToCurrency(map, amount.currency, amount.amountMinor);
  }

  return [...map.entries()]
    .map(([currency, amountMinor]) => ({ currency, amountMinor }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

export interface CashEvent {
  currency: string;
  grossMinor: number;
  refundMinor: number;
  paidAt: Date | null;
  customerId: string;
  invoiceId: string;
  subscriptionId: string | null;
}

/**
 * Produces cash events from invoice/payment records. Gateway refunds are
 * represented by PaymentRefund rows; manual refunds are represented by the
 * payment's refundedAmountMinor and refundedAt fields.
 */
export function cashEventsFromInvoices(
  invoices: readonly InvoiceRecord[],
): CashEvent[] {
  const events: CashEvent[] = [];

  for (const invoice of invoices) {
    for (const payment of invoice.payments) {
      if (payment.status !== "SUCCEEDED" && payment.status !== "REFUNDED") {
        continue;
      }

      if (payment.paidAt) {
        events.push({
          currency: payment.currency,
          grossMinor: payment.amountMinor,
          refundMinor: 0,
          paidAt: payment.paidAt,
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          subscriptionId: invoice.subscriptionId,
        });
      }

      const succeededRefunds = payment.refunds.filter(
        (refund) => refund.status === "SUCCEEDED",
      );

      if (succeededRefunds.length > 0) {
        for (const refund of succeededRefunds) {
          events.push({
            currency: refund.currency,
            grossMinor: 0,
            refundMinor: refund.amountMinor,
            paidAt: refund.processedAt,
            customerId: invoice.customerId,
            invoiceId: invoice.id,
            subscriptionId: invoice.subscriptionId,
          });
        }
      } else if (
        payment.status === "REFUNDED" &&
        payment.refundedAt &&
        payment.refundedAmountMinor > 0
      ) {
        events.push({
          currency: payment.currency,
          grossMinor: 0,
          refundMinor: payment.refundedAmountMinor,
          paidAt: payment.refundedAt,
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          subscriptionId: invoice.subscriptionId,
        });
      }
    }
  }

  return events;
}

export function isSuccessfulPayment(
  payment: PaymentRecord,
): payment is PaymentRecord & { paidAt: Date } {
  return (
    (payment.status === "SUCCEEDED" || payment.status === "REFUNDED") &&
    payment.paidAt !== null
  );
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function invoiceOutstandingMinor(invoice: InvoiceRecord): number {
  if (invoice.status !== "OPEN") {
    return 0;
  }

  return Math.max(invoice.totalMinor - invoice.amountPaidMinor, 0);
}

export function invoiceOverdueMinor(invoice: InvoiceRecord, now: Date): number {
  if (
    invoice.status !== "OPEN" ||
    !invoice.dueAt ||
    invoice.dueAt.getTime() >= now.getTime()
  ) {
    return 0;
  }

  return Math.max(invoice.totalMinor - invoice.amountPaidMinor, 0);
}

export function daysOverdue(invoice: InvoiceRecord, now: Date): number {
  if (!invoice.dueAt) {
    return 0;
  }

  return Math.floor(
    (now.getTime() - invoice.dueAt.getTime()) / 86_400_000,
  );
}

export function agingBucketForInvoice(
  invoice: InvoiceRecord,
  now: Date,
): "current" | "1-30" | "31-60" | "61-90" | "90+" {
  if (!invoice.dueAt || invoice.dueAt.getTime() >= now.getTime()) {
    return "current";
  }

  const overdue = daysOverdue(invoice, now);

  if (overdue <= 30) {
    return "1-30";
  }

  if (overdue <= 60) {
    return "31-60";
  }

  if (overdue <= 90) {
    return "61-90";
  }

  return "90+";
}

export function latestDate(dates: readonly (Date | null)[]): Date | null {
  const timestamps = dates
    .filter((date): date is Date => date !== null)
    .map((date) => date.getTime());

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps));
}

export function earliestDate(dates: readonly (Date | null)[]): Date | null {
  const timestamps = dates
    .filter((date): date is Date => date !== null)
    .map((date) => date.getTime());

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.min(...timestamps));
}
