import type { BillingInterval } from "@subscript/shared";
import { parseMajorAmount } from "@/lib/money";

export interface PlanFormValues {
  name: string;
  description: string;
  amount: string;
  currency: string;
  interval: BillingInterval;
  trialDays: string;
}

export type PlanFormErrors = Record<string, string>;

export function validatePlanForm(values: PlanFormValues): PlanFormErrors {
  const errors: PlanFormErrors = {};
  const name = values.name.trim();

  if (name.length === 0) {
    errors.name = "Enter a plan name.";
  } else if (name.length < 2) {
    errors.name = "Use at least 2 characters.";
  } else if (name.length > 120) {
    errors.name = "Plan name must be 120 characters or fewer.";
  }

  if (values.description.trim().length > 1000) {
    errors.description = "Description must be 1,000 characters or fewer.";
  }

  const currency = values.currency.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(currency)) {
    errors.currency = "Use a three-letter currency code.";
  }

  if (values.amount.trim().length === 0) {
    errors.amount = "Enter an amount.";
  } else if (parseMajorAmount(values.amount, currency) === null) {
    errors.amount = `Enter a valid ${currency || "currency"} amount.`;
  }

  const trialDays = Number(values.trialDays);

  if (
    values.trialDays.trim().length === 0 ||
    !Number.isInteger(trialDays) ||
    trialDays < 0 ||
    trialDays > 365
  ) {
    errors.trialDays = "Use a whole number between 0 and 365.";
  }

  return errors;
}
