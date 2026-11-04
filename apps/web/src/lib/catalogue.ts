import type {
  BillingInterval,
  CustomerStatus,
  PlanStatus,
} from "@subscript/shared";

export const customerStatusLabels: Record<CustomerStatus, string> = {
  ACTIVE: "Active",
  ARCHIVED: "Archived",
};

export const planStatusLabels: Record<PlanStatus, string> = {
  ACTIVE: "Active",
  ARCHIVED: "Archived",
};

export const billingIntervalLabels: Record<BillingInterval, string> = {
  MONTH: "Monthly",
  YEAR: "Yearly",
};

export function getBillingIntervalLabel(interval: BillingInterval): string {
  return billingIntervalLabels[interval];
}

export function getTrialLabel(trialDays: number): string {
  if (trialDays === 0) {
    return "No trial";
  }

  return `${trialDays} ${trialDays === 1 ? "day" : "days"}`;
}
