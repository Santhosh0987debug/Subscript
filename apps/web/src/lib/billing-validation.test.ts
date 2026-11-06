import { describe, expect, it } from "vitest";
import {
  parseTaxRateBps,
  validateGatewayRefundForm,
  validateGenerateInvoiceForm,
  validatePaymentForm,
  validateSubscriptionForm,
  type PaymentFormValues,
  type SubscriptionFormValues,
} from "@/lib/billing-validation";

const validSubscription: SubscriptionFormValues = {
  customerId: "customer_1",
  planId: "plan_1",
  startDate: "2026-01-31",
  quantity: "2",
  trialDays: "",
  nextBillingDate: "",
};

const validPayment: PaymentFormValues = {
  amount: "10.00",
  method: "BANK_TRANSFER",
  reference: "",
  note: "",
  status: "SUCCEEDED",
};

describe("subscription form validation", () => {
  it("accepts a complete subscription", () => {
    expect(validateSubscriptionForm(validSubscription, 14)).toEqual({});
  });

  it("requires a customer and plan", () => {
    const errors = validateSubscriptionForm(
      { ...validSubscription, customerId: "", planId: "" },
      0,
    );

    expect(errors.customerId).toBeDefined();
    expect(errors.planId).toBeDefined();
  });

  it("rejects impossible dates and invalid quantities", () => {
    const errors = validateSubscriptionForm(
      {
        ...validSubscription,
        startDate: "2026-02-30",
        quantity: "0",
      },
      0,
    );

    expect(errors.startDate).toBeDefined();
    expect(errors.quantity).toBeDefined();
  });

  it("validates the trial override", () => {
    expect(
      validateSubscriptionForm({ ...validSubscription, trialDays: "366" }, 0)
        .trialDays,
    ).toBeDefined();
    expect(
      validateSubscriptionForm({ ...validSubscription, trialDays: "14" }, 0)
        .trialDays,
    ).toBeUndefined();
  });

  it("requires the next billing date to follow the first paid period", () => {
    expect(
      validateSubscriptionForm(
        { ...validSubscription, nextBillingDate: "2026-01-15" },
        0,
      ).nextBillingDate,
    ).toBeDefined();

    expect(
      validateSubscriptionForm(
        {
          ...validSubscription,
          trialDays: "10",
          nextBillingDate: "2026-02-05",
        },
        0,
      ).nextBillingDate,
    ).toBeDefined();

    expect(
      validateSubscriptionForm(
        {
          ...validSubscription,
          trialDays: "10",
          nextBillingDate: "2026-02-28",
        },
        0,
      ).nextBillingDate,
    ).toBeUndefined();
  });
});

describe("tax rate parsing", () => {
  it("converts percentages into integer basis points", () => {
    expect(parseTaxRateBps("8.25")).toBe(825);
    expect(parseTaxRateBps("8.2")).toBe(820);
    expect(parseTaxRateBps("8%")).toBe(800);
    expect(parseTaxRateBps("0")).toBe(0);
    expect(parseTaxRateBps("100")).toBe(10_000);
  });

  it("rejects more precision than basis points can represent", () => {
    expect(parseTaxRateBps("8.255")).toBeNull();
    expect(parseTaxRateBps("-8")).toBeNull();
    expect(parseTaxRateBps("eight")).toBeNull();
    expect(parseTaxRateBps("")).toBeNull();
  });

  it("validates the full invoice form", () => {
    expect(
      validateGenerateInvoiceForm({
        taxRate: "8.25",
        dueInDays: "7",
        description: "",
      }).errors,
    ).toEqual({});

    const errors = validateGenerateInvoiceForm({
      taxRate: "101",
      dueInDays: "-1",
      description: "x".repeat(301),
    }).errors;

    expect(errors.taxRate).toBeDefined();
    expect(errors.dueInDays).toBeDefined();
    expect(errors.description).toBeDefined();
  });
});

describe("payment form validation", () => {
  const options = { amountDueMinor: 2900, currency: "USD" };

  it("accepts a valid partial payment", () => {
    const result = validatePaymentForm(validPayment, options);

    expect(result.errors).toEqual({});
    expect(result.amountMinor).toBe(1000);
  });

  it("accepts paying the exact outstanding balance", () => {
    const result = validatePaymentForm(
      { ...validPayment, amount: "29.00" },
      options,
    );

    expect(result.errors).toEqual({});
    expect(result.amountMinor).toBe(2900);
  });

  it("rejects overpayment, zero, and malformed amounts", () => {
    expect(
      validatePaymentForm({ ...validPayment, amount: "29.01" }, options).errors
        .amount,
    ).toBeDefined();
    expect(
      validatePaymentForm({ ...validPayment, amount: "0" }, options).errors
        .amount,
    ).toBeDefined();
    expect(
      validatePaymentForm({ ...validPayment, amount: "ten" }, options).errors
        .amount,
    ).toBeDefined();
  });

  it("only allows pending and succeeded records", () => {
    expect(
      validatePaymentForm(
        { ...validPayment, status: "REFUNDED" as unknown as "SUCCEEDED" },
        options,
      ).errors.status,
    ).toBeDefined();
    expect(
      validatePaymentForm({ ...validPayment, status: "PENDING" }, options).errors
        .status,
    ).toBeUndefined();
  });

  it("rejects overly long references and notes", () => {
    const errors = validatePaymentForm(
      {
        ...validPayment,
        reference: "r".repeat(161),
        note: "n".repeat(501),
      },
      options,
    ).errors;

    expect(errors.reference).toBeDefined();
    expect(errors.note).toBeDefined();
  });
});

describe("gateway refund form validation", () => {
  const options = { refundableMinor: 2_900, currency: "USD" };

  it("accepts a partial or full refundable amount", () => {
    expect(
      validateGatewayRefundForm({ amount: "10.00", reason: "" }, options),
    ).toEqual({ errors: {}, amountMinor: 1_000 });
    expect(
      validateGatewayRefundForm({ amount: "29.00", reason: "Full credit" }, options),
    ).toEqual({ errors: {}, amountMinor: 2_900 });
  });

  it("requires an amount greater than zero", () => {
    expect(
      validateGatewayRefundForm({ amount: "", reason: "" }, options).errors.amount,
    ).toBeDefined();
    expect(
      validateGatewayRefundForm({ amount: "0", reason: "" }, options).errors
        .amount,
    ).toBeDefined();
    expect(
      validateGatewayRefundForm({ amount: "not-money", reason: "" }, options)
        .errors.amount,
    ).toBeDefined();
  });

  it("rejects refunds above the refundable balance", () => {
    const result = validateGatewayRefundForm(
      { amount: "29.01", reason: "" },
      options,
    );

    expect(result.amountMinor).toBe(2_901);
    expect(result.errors.amount).toContain("$29.00");
  });

  it("limits the optional reason to 500 characters", () => {
    const result = validateGatewayRefundForm(
      { amount: "10.00", reason: "r".repeat(501) },
      options,
    );

    expect(result.errors.reason).toBeDefined();
  });
});
