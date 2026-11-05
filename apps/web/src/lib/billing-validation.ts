import {
  PAYMENT_METHODS,
  addUtcDays,
  parseIsoDate,
  type PaymentMethod,
  type RecordablePaymentStatus,
} from "@subscript/shared";
import { formatMoney, parseMajorAmount } from "@/lib/money";

export interface SubscriptionFormValues {
  customerId: string;
  planId: string;
  startDate: string;
  quantity: string;
  trialDays: string;
  nextBillingDate: string;
}

export type BillingFormErrors = Record<string, string>;

export function validateSubscriptionForm(
  values: SubscriptionFormValues,
  planTrialDays: number,
): BillingFormErrors {
  const errors: BillingFormErrors = {};

  if (values.customerId.trim().length === 0) {
    errors.customerId = "Choose a customer.";
  }

  if (values.planId.trim().length === 0) {
    errors.planId = "Choose a plan.";
  }

  const startDate = parseIsoDate(values.startDate.trim());

  if (!startDate) {
    errors.startDate = "Use a real calendar date.";
  }

  const quantity = Number(values.quantity);

  if (
    values.quantity.trim().length === 0 ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 10_000
  ) {
    errors.quantity = "Use a whole number between 1 and 10,000.";
  }

  let effectiveTrialDays = planTrialDays;
  const trialDaysValue = values.trialDays.trim();

  if (trialDaysValue.length > 0) {
    const trialDays = Number(trialDaysValue);

    if (
      !Number.isInteger(trialDays) ||
      trialDays < 0 ||
      trialDays > 365
    ) {
      errors.trialDays = "Use a whole number between 0 and 365.";
    } else {
      effectiveTrialDays = trialDays;
    }
  }

  const nextBillingValue = values.nextBillingDate.trim();

  if (nextBillingValue.length > 0) {
    const nextBillingDate = parseIsoDate(nextBillingValue);

    if (!nextBillingDate) {
      errors.nextBillingDate = "Use a real calendar date.";
    } else if (startDate) {
      const firstPaidPeriodStart =
        effectiveTrialDays > 0
          ? addUtcDays(startDate, effectiveTrialDays)
          : startDate;

      if (nextBillingDate.getTime() <= firstPaidPeriodStart.getTime()) {
        errors.nextBillingDate =
          "Next billing date must be after the first paid period starts.";
      }
    }
  }

  return errors;
}

export interface PaymentFormValues {
  amount: string;
  method: PaymentMethod;
  reference: string;
  note: string;
  status: RecordablePaymentStatus;
}

export interface PaymentValidationOptions {
  amountDueMinor: number;
  currency: string;
}

export interface PaymentValidationResult {
  errors: BillingFormErrors;
  amountMinor: number | null;
}

export function validatePaymentForm(
  values: PaymentFormValues,
  options: PaymentValidationOptions,
): PaymentValidationResult {
  const errors: BillingFormErrors = {};
  const amountMinor = parseMajorAmount(values.amount, options.currency);

  if (values.amount.trim().length === 0) {
    errors.amount = "Enter an amount.";
  } else if (amountMinor === null) {
    errors.amount = `Enter a valid ${options.currency} amount.`;
  } else if (amountMinor <= 0) {
    errors.amount = "Enter an amount greater than zero.";
  } else if (amountMinor > options.amountDueMinor) {
    errors.amount = `Payment cannot exceed the ${formatMoney(
      options.amountDueMinor,
      options.currency,
    )} outstanding balance.`;
  }

  if (!PAYMENT_METHODS.includes(values.method)) {
    errors.method = "Choose a payment method.";
  }

  if (values.reference.trim().length > 160) {
    errors.reference = "Reference must be 160 characters or fewer.";
  }

  if (values.note.trim().length > 500) {
    errors.note = "Note must be 500 characters or fewer.";
  }

  if (values.status !== "PENDING" && values.status !== "SUCCEEDED") {
    errors.status = "Choose whether the payment is pending or succeeded.";
  }

  return { errors, amountMinor };
}

export interface GenerateInvoiceFormValues {
  taxRate: string;
  dueInDays: string;
  description: string;
}

export interface GenerateInvoiceFormResult {
  errors: BillingFormErrors;
  taxRateBps: number | null;
  dueInDays: number;
  description: string | null;
}

/**
 * Converts a percentage such as `8.25` into basis points without floating
 * point arithmetic. More than two decimal places cannot be represented in
 * integer basis points.
 */
export function parseTaxRateBps(value: string): number | null {
  const normalized = value.trim().replace(/%$/, "").trim();

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const [whole = "0", fraction = ""] = normalized.split(".");
  const bps =
    Number.parseInt(whole, 10) * 100 +
    Number.parseInt(fraction.padEnd(2, "0") || "0", 10);

  return Number.isSafeInteger(bps) ? bps : null;
}

export function validateGenerateInvoiceForm(
  values: GenerateInvoiceFormValues,
): GenerateInvoiceFormResult {
  const errors: BillingFormErrors = {};
  const taxRateBps = parseTaxRateBps(values.taxRate);

  if (values.taxRate.trim().length === 0) {
    errors.taxRate = "Enter a tax rate.";
  } else if (taxRateBps === null) {
    errors.taxRate = "Use a percentage with up to two decimal places.";
  } else if (taxRateBps > 10_000) {
    errors.taxRate = "Tax rate cannot exceed 100%.";
  }

  const dueInDays = Number(values.dueInDays);

  if (
    values.dueInDays.trim().length === 0 ||
    !Number.isInteger(dueInDays) ||
    dueInDays < 0 ||
    dueInDays > 365
  ) {
    errors.dueInDays = "Use a whole number between 0 and 365.";
  }

  const description = values.description.trim();

  if (description.length > 300) {
    errors.description = "Description must be 300 characters or fewer.";
  }

  return {
    errors,
    taxRateBps,
    dueInDays: Number.isInteger(dueInDays) ? dueInDays : 7,
    description: description.length > 0 ? description : null,
  };
}
