import { describe, expect, it } from "vitest";
import {
  addBillingInterval,
  addUtcDays,
  calculateInvoiceTotals,
  calculateTaxMinor,
  formatIsoDate,
  parseIsoDate,
} from "@subscript/shared";
import {
  canGenerateInvoice,
  invoiceStatusForBalance,
  resolveInvoiceAction,
  resolvePaymentTransition,
  resolveSubscriptionTransition,
} from "../src/billing/lifecycle.js";
import {
  InvalidSubscriptionTransitionError,
  InvoiceStateConflictError,
  PaymentStateConflictError,
} from "../src/billing/errors.js";

function date(value: string): Date {
  const parsed = parseIsoDate(value);

  if (!parsed) {
    throw new Error(`Unexpected test date ${value}`);
  }

  return parsed;
}

describe("billing calendar", () => {
  it("clamps month-end billing dates to the last day of the target month", () => {
    expect(
      formatIsoDate(addBillingInterval(date("2026-01-31"), "MONTH")),
    ).toBe("2026-02-28");
    expect(
      formatIsoDate(addBillingInterval(date("2026-03-31"), "MONTH")),
    ).toBe("2026-04-30");
    expect(
      formatIsoDate(addBillingInterval(date("2026-12-31"), "MONTH")),
    ).toBe("2027-01-31");
  });

  it("handles leap-day annual renewals and leap-year Februaries", () => {
    expect(
      formatIsoDate(addBillingInterval(date("2024-02-29"), "YEAR")),
    ).toBe("2025-02-28");
    expect(
      formatIsoDate(addBillingInterval(date("2028-02-29"), "MONTH")),
    ).toBe("2028-03-29");
    expect(
      formatIsoDate(addBillingInterval(date("2027-01-31"), "MONTH")),
    ).toBe("2027-02-28");
  });

  it("adds trial days across month and year boundaries", () => {
    expect(formatIsoDate(addUtcDays(date("2026-12-25"), 14))).toBe(
      "2027-01-08",
    );
    expect(formatIsoDate(addUtcDays(date("2028-02-24"), 7))).toBe(
      "2028-03-02",
    );
  });

  it("rejects impossible calendar dates", () => {
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("2026-1-01")).toBeNull();
    expect(formatIsoDate(date("2026-02-28"))).toBe("2026-02-28");
  });
});

describe("invoice totals", () => {
  it("calculates tax in basis points with minor-unit rounding", () => {
    expect(calculateTaxMinor(10_000, 825)).toBe(825);
    expect(calculateTaxMinor(1_999, 825)).toBe(165);
    expect(calculateTaxMinor(2_900, 0)).toBe(0);
    expect(calculateTaxMinor(2_900, 10_000)).toBe(2_900);
  });

  it("returns subtotal, tax, and total together", () => {
    expect(calculateInvoiceTotals(5_800, 725)).toEqual({
      subtotalMinor: 5_800,
      taxMinor: 421,
      totalMinor: 6_221,
    });
  });
});

describe("subscription lifecycle", () => {
  function transition(
    status: Parameters<typeof resolveSubscriptionTransition>[0]["status"],
    action: Parameters<typeof resolveSubscriptionTransition>[0]["action"],
    overrides: Partial<
      Parameters<typeof resolveSubscriptionTransition>[0]
    > = {},
  ) {
    return resolveSubscriptionTransition({
      status,
      cancelAtPeriodEnd: false,
      action,
      ...overrides,
    });
  }

  it("allows pause only from active", () => {
    expect(transition("ACTIVE", "pause")).toMatchObject({
      status: "PAUSED",
      activityType: "PAUSED",
      advancePeriod: false,
    });
    expect(() => transition("PAUSED", "pause")).toThrow(
      InvalidSubscriptionTransitionError,
    );
    expect(() => transition("TRIALING", "pause")).toThrow(
      InvalidSubscriptionTransitionError,
    );
    expect(() => transition("CANCELED", "pause")).toThrow(
      InvalidSubscriptionTransitionError,
    );
  });

  it("allows resume only from paused", () => {
    expect(transition("PAUSED", "resume")).toMatchObject({
      status: "ACTIVE",
      activityType: "RESUMED",
    });
    expect(() => transition("ACTIVE", "resume")).toThrow(
      InvalidSubscriptionTransitionError,
    );
  });

  it("schedules cancellation without changing the current state", () => {
    expect(transition("ACTIVE", "cancel", { atPeriodEnd: true })).toEqual({
      status: "ACTIVE",
      cancelAtPeriodEnd: true,
      advancePeriod: false,
      activityType: "CANCEL_SCHEDULED",
    });
    expect(() =>
      transition("ACTIVE", "cancel", {
        atPeriodEnd: false,
        cancelAtPeriodEnd: true,
      }),
    ).toThrow(InvalidSubscriptionTransitionError);
    expect(transition("ACTIVE", "cancel", { atPeriodEnd: false })).toEqual({
      status: "CANCELED",
      cancelAtPeriodEnd: false,
      advancePeriod: false,
      activityType: "CANCELED",
    });
    expect(() => transition("CANCELED", "cancel")).toThrow(
      InvalidSubscriptionTransitionError,
    );
  });

  it("activates a trial without advancing the paid period", () => {
    expect(transition("TRIALING", "renew")).toEqual({
      status: "ACTIVE",
      cancelAtPeriodEnd: false,
      advancePeriod: false,
      activityType: "ACTIVATED",
    });
  });

  it("advances active and past-due renewals", () => {
    expect(transition("ACTIVE", "renew")).toMatchObject({
      status: "ACTIVE",
      advancePeriod: true,
      activityType: "RENEWED",
    });
    expect(transition("PAST_DUE", "renew")).toMatchObject({
      status: "ACTIVE",
      advancePeriod: true,
      activityType: "RENEWED",
    });
  });

  it("ends a subscription on renewal when cancellation is scheduled", () => {
    expect(
      transition("ACTIVE", "renew", { cancelAtPeriodEnd: true }),
    ).toMatchObject({
      status: "CANCELED",
      cancelAtPeriodEnd: false,
      advancePeriod: false,
      activityType: "CANCELED",
    });
  });

  it("rejects renewal from paused, canceled, and expired states", () => {
    for (const status of ["PAUSED", "CANCELED", "EXPIRED"] as const) {
      expect(() => transition(status, "renew")).toThrow(
        InvalidSubscriptionTransitionError,
      );
    }
  });

  it("marks trialing and active subscriptions past due", () => {
    expect(transition("ACTIVE", "markPastDue")).toMatchObject({
      status: "PAST_DUE",
    });
    expect(transition("TRIALING", "markPastDue")).toMatchObject({
      status: "PAST_DUE",
    });
    expect(() => transition("PAUSED", "markPastDue")).toThrow(
      InvalidSubscriptionTransitionError,
    );
  });

  it("expires any non-expired subscription once", () => {
    for (const status of [
      "TRIALING",
      "ACTIVE",
      "PAST_DUE",
      "PAUSED",
      "CANCELED",
    ] as const) {
      expect(transition(status, "expire")).toMatchObject({
        status: "EXPIRED",
        activityType: "EXPIRED",
      });
    }

    expect(() => transition("EXPIRED", "expire")).toThrow(
      InvalidSubscriptionTransitionError,
    );
  });

  it("limits invoice generation to live billing states", () => {
    expect(canGenerateInvoice("TRIALING")).toBe(true);
    expect(canGenerateInvoice("ACTIVE")).toBe(true);
    expect(canGenerateInvoice("PAST_DUE")).toBe(true);
    expect(canGenerateInvoice("PAUSED")).toBe(false);
    expect(canGenerateInvoice("CANCELED")).toBe(false);
    expect(canGenerateInvoice("EXPIRED")).toBe(false);
  });
});

describe("invoice and payment lifecycle", () => {
  it("only issues drafts", () => {
    expect(resolveInvoiceAction("DRAFT", "issue", 0)).toEqual({
      status: "OPEN",
      activityType: "ISSUED",
    });
    expect(() => resolveInvoiceAction("OPEN", "issue", 0)).toThrow(
      InvoiceStateConflictError,
    );
    expect(() => resolveInvoiceAction("PAID", "issue", 100)).toThrow(
      InvoiceStateConflictError,
    );
  });

  it("refuses to void or write off invoices with payments", () => {
    expect(resolveInvoiceAction("OPEN", "void", 0)).toEqual({
      status: "VOID",
      activityType: "VOIDED",
    });
    expect(() => resolveInvoiceAction("OPEN", "void", 1)).toThrow(
      InvoiceStateConflictError,
    );
    expect(() => resolveInvoiceAction("OPEN", "markUncollectible", 1)).toThrow(
      InvoiceStateConflictError,
    );
    expect(resolveInvoiceAction("DRAFT", "markUncollectible", 0)).toEqual({
      status: "UNCOLLECTIBLE",
      activityType: "MARKED_UNCOLLECTIBLE",
    });
  });

  it("allows only pending payments to succeed or fail", () => {
    expect(resolvePaymentTransition("PENDING", "succeed")).toBe("SUCCEEDED");
    expect(resolvePaymentTransition("PENDING", "fail")).toBe("FAILED");
    expect(resolvePaymentTransition("SUCCEEDED", "refund")).toBe("REFUNDED");
    expect(() => resolvePaymentTransition("SUCCEEDED", "succeed")).toThrow(
      PaymentStateConflictError,
    );
    expect(() => resolvePaymentTransition("FAILED", "refund")).toThrow(
      PaymentStateConflictError,
    );
    expect(() => resolvePaymentTransition("REFUNDED", "refund")).toThrow(
      PaymentStateConflictError,
    );
  });

  it("derives paid or open status from the remaining balance", () => {
    expect(invoiceStatusForBalance(3_000, 3_000).status).toBe("PAID");
    expect(invoiceStatusForBalance(3_000, 1_000).status).toBe("OPEN");
    expect(invoiceStatusForBalance(3_000, 0).paidAt).toBeNull();
    expect(invoiceStatusForBalance(3_000, 3_000).paidAt).toBeInstanceOf(Date);
  });
});
