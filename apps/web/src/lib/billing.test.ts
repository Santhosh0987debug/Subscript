import { describe, expect, it } from "vitest";
import type { Payment, Subscription } from "@subscript/shared";
import {
  formatActivityTime,
  formatBillingDate,
  formatBillingPeriod,
  formatTaxRateBps,
  getGatewayRefundableMinor,
  getInvoiceActionAvailability,
  getNextBillingSummary,
  getPaymentActionAvailability,
  getSubscriptionActionAvailability,
  invoiceStatusLabels,
  paymentMethodLabels,
  paymentStatusLabels,
  subscriptionStatusLabels,
} from "@/lib/billing";

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "payment_1",
    organizationId: "organization_1",
    invoiceId: "invoice_1",
    invoiceNumber: "INV-000001",
    subscriptionId: null,
    amount: { amountMinor: 2_900, currency: "USD" },
    method: "CARD",
    status: "SUCCEEDED",
    source: "GATEWAY",
    reference: null,
    note: null,
    gateway: {
      provider: "razorpay",
      orderId: "order_1",
      paymentId: "pay_1",
      status: "captured",
    },
    refundedAmount: { amountMinor: 0, currency: "USD" },
    refunds: [],
    paidAt: "2026-01-01T00:00:00.000Z",
    failedAt: null,
    refundedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSubscription(overrides: Partial<Subscription>): Subscription {
  return {
    id: "subscription_1",
    organizationId: "organization_1",
    customerId: "customer_1",
    customerName: "Acme Studio",
    customerEmail: "billing@acme.example",
    planId: "plan_1",
    planName: "Growth",
    planCode: "GROWTH",
    status: "ACTIVE",
    quantity: 1,
    price: { amountMinor: 2900, currency: "USD" },
    interval: "MONTH",
    trialDays: 0,
    startedAt: "2026-01-01",
    trialEndsAt: null,
    currentPeriodStart: "2026-01-01",
    currentPeriodEnd: "2026-02-01",
    nextBillingDate: "2026-02-01",
    cancelAtPeriodEnd: false,
    canceledAt: null,
    pausedAt: null,
    endedAt: null,
    outstanding: { amountMinor: 0, currency: "USD" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("billing labels", () => {
  it("labels every subscription status", () => {
    expect(subscriptionStatusLabels.TRIALING).toBe("Trialing");
    expect(subscriptionStatusLabels.ACTIVE).toBe("Active");
    expect(subscriptionStatusLabels.PAST_DUE).toBe("Past due");
    expect(subscriptionStatusLabels.PAUSED).toBe("Paused");
    expect(subscriptionStatusLabels.CANCELED).toBe("Canceled");
    expect(subscriptionStatusLabels.EXPIRED).toBe("Expired");
  });

  it("labels every invoice status", () => {
    expect(invoiceStatusLabels.UNCOLLECTIBLE).toBe("Uncollectible");
    expect(invoiceStatusLabels.DRAFT).toBe("Draft");
  });

  it("labels payment methods and statuses", () => {
    expect(paymentMethodLabels.BANK_TRANSFER).toBe("Bank transfer");
    expect(paymentStatusLabels.SUCCEEDED).toBe("Succeeded");
    expect(paymentStatusLabels.REFUNDED).toBe("Refunded");
  });
});

describe("billing date formatting", () => {
  it("formats calendar dates in UTC", () => {
    expect(formatBillingDate("2026-03-15")).toBe("Mar 15, 2026");
    expect(formatBillingDate("2026-03-15T23:30:00.000Z")).toBe("Mar 15, 2026");
  });

  it("handles missing and invalid values", () => {
    expect(formatBillingDate(null)).toBe("Not set");
    expect(formatBillingDate("not-a-date")).toBe("Unknown");
    expect(formatActivityTime(null)).toBe("Unknown time");
  });

  it("formats billing periods and empty periods", () => {
    expect(formatBillingPeriod("2026-01-01", "2026-02-01")).toBe(
      "Jan 1, 2026 - Feb 1, 2026",
    );
    expect(formatBillingPeriod(null, null)).toBe("No billing period");
  });

  it("formats basis-point tax rates without trailing zeros", () => {
    expect(formatTaxRateBps(0)).toBe("0%");
    expect(formatTaxRateBps(250)).toBe("2.5%");
    expect(formatTaxRateBps(825)).toBe("8.25%");
    expect(formatTaxRateBps(10_000)).toBe("100%");
  });
});

describe("next billing summaries", () => {
  it("uses the trial end while trialing", () => {
    const summary = getNextBillingSummary(
      makeSubscription({
        status: "TRIALING",
        trialEndsAt: "2026-01-15",
        nextBillingDate: "2026-01-15",
      }),
    );

    expect(summary).toEqual({ label: "Trial ends", date: "Jan 15, 2026" });
  });

  it("uses the next billing date for active subscriptions", () => {
    expect(getNextBillingSummary(makeSubscription({}))).toEqual({
      label: "Next billing",
      date: "Feb 1, 2026",
    });
  });

  it("marks paused and ended subscriptions clearly", () => {
    expect(
      getNextBillingSummary(makeSubscription({ status: "PAUSED" })).label,
    ).toBe("Billing paused");
    expect(
      getNextBillingSummary(
        makeSubscription({
          status: "CANCELED",
          endedAt: "2026-02-01T00:00:00.000Z",
        }),
      ).label,
    ).toBe("Ended");
  });
});

describe("action availability", () => {
  it("allows pause only while active and resume only while paused", () => {
    expect(getSubscriptionActionAvailability("ACTIVE", false).pause).toBe(true);
    expect(getSubscriptionActionAvailability("PAST_DUE", false).pause).toBe(
      false,
    );
    expect(getSubscriptionActionAvailability("PAUSED", false).resume).toBe(true);
    expect(getSubscriptionActionAvailability("ACTIVE", false).resume).toBe(
      false,
    );
  });

  it("generates invoices only for live billing states", () => {
    expect(
      getSubscriptionActionAvailability("TRIALING", false).generateInvoice,
    ).toBe(true);
    expect(
      getSubscriptionActionAvailability("PAST_DUE", false).generateInvoice,
    ).toBe(true);
    expect(
      getSubscriptionActionAvailability("PAUSED", false).generateInvoice,
    ).toBe(false);
    expect(
      getSubscriptionActionAvailability("CANCELED", false).generateInvoice,
    ).toBe(false);
  });

  it("hides cancellation once it is already scheduled", () => {
    const scheduled = getSubscriptionActionAvailability("ACTIVE", true);

    expect(scheduled.cancelAtPeriodEnd).toBe(false);
    expect(scheduled.cancelImmediately).toBe(false);

    const active = getSubscriptionActionAvailability("ACTIVE", false);

    expect(active.cancelAtPeriodEnd).toBe(true);
    expect(active.cancelImmediately).toBe(true);
  });

  it("only offers immediate cancellation while paused", () => {
    const paused = getSubscriptionActionAvailability("PAUSED", false);

    expect(paused.cancelAtPeriodEnd).toBe(false);
    expect(paused.cancelImmediately).toBe(true);
  });

  it("keeps void and write-off behind an unpaid editable invoice", () => {
    expect(getInvoiceActionAvailability("DRAFT", 0)).toEqual({
      issue: true,
      void: true,
      markUncollectible: true,
    });
    expect(getInvoiceActionAvailability("OPEN", 100)).toEqual({
      issue: false,
      void: false,
      markUncollectible: false,
    });
    expect(getInvoiceActionAvailability("PAID", 0)).toEqual({
      issue: false,
      void: false,
      markUncollectible: false,
    });
  });

  it("applies payment transitions from the current state", () => {
    expect(getPaymentActionAvailability("PENDING")).toEqual({
      succeed: true,
      fail: true,
      refund: false,
    });
    expect(getPaymentActionAvailability("SUCCEEDED")).toEqual({
      succeed: false,
      fail: false,
      refund: true,
    });
    expect(getPaymentActionAvailability("REFUNDED")).toEqual({
      succeed: false,
      fail: false,
      refund: false,
    });
  });
});

describe("gateway refundable balance", () => {
  it("subtracts completed and pending refunds from a captured gateway payment", () => {
    const payment = makePayment({
      refundedAmount: { amountMinor: 1_000, currency: "USD" },
      refunds: [
        {
          id: "refund_1",
          paymentId: "payment_1",
          provider: "razorpay",
          providerRefundId: "rfnd_1",
          amount: { amountMinor: 500, currency: "USD" },
          status: "PENDING",
          reason: null,
          processedAt: null,
          failedAt: null,
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });

    expect(getGatewayRefundableMinor(payment)).toBe(1_400);
  });

  it("returns zero for manual, pending, and fully refunded payments", () => {
    expect(getGatewayRefundableMinor(makePayment({ source: "MANUAL" }))).toBe(0);
    expect(getGatewayRefundableMinor(makePayment({ status: "PENDING" }))).toBe(0);
    expect(
      getGatewayRefundableMinor(
        makePayment({
          status: "REFUNDED",
          refundedAmount: { amountMinor: 2_900, currency: "USD" },
        }),
      ),
    ).toBe(0);
  });

  it("never returns a negative balance", () => {
    expect(
      getGatewayRefundableMinor(
        makePayment({
          refundedAmount: { amountMinor: 3_000, currency: "USD" },
        }),
      ),
    ).toBe(0);
  });
});
