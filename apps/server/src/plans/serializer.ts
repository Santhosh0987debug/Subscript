import type { Plan } from "@subscript/shared";
import type { PlanRecord } from "./types.js";

export function toPlan(plan: PlanRecord): Plan {
  return {
    id: plan.id,
    organizationId: plan.organizationId,
    name: plan.name,
    code: plan.code,
    description: plan.description,
    price: {
      amountMinor: plan.amountMinor,
      currency: plan.currency,
    },
    interval: plan.interval,
    trialDays: plan.trialDays,
    status: plan.status,
    subscriptionCount: plan.subscriptionCount,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}
