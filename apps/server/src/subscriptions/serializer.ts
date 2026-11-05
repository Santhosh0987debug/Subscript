import type {
  Subscription,
  SubscriptionActivity,
} from "@subscript/shared";
import type {
  SubscriptionActivityRecord,
  SubscriptionRecord,
} from "./types.js";

export function toSubscription(
  subscription: SubscriptionRecord,
  outstandingMinor = 0,
): Subscription {
  const nextBillingDate =
    subscription.status === "TRIALING" && subscription.trialEndsAt
      ? subscription.trialEndsAt
      : subscription.currentPeriodEnd;

  return {
    id: subscription.id,
    organizationId: subscription.organizationId,
    customerId: subscription.customerId,
    customerName: subscription.customerName,
    customerEmail: subscription.customerEmail,
    planId: subscription.planId,
    planName: subscription.planName,
    planCode: subscription.planCode,
    status: subscription.status,
    quantity: subscription.quantity,
    price: {
      amountMinor: subscription.unitAmountMinor,
      currency: subscription.currency,
    },
    interval: subscription.interval,
    trialDays: subscription.trialDays,
    startedAt: subscription.startedAt.toISOString(),
    trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
    currentPeriodStart: subscription.currentPeriodStart.toISOString(),
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    nextBillingDate: nextBillingDate.toISOString(),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    canceledAt: subscription.canceledAt?.toISOString() ?? null,
    pausedAt: subscription.pausedAt?.toISOString() ?? null,
    endedAt: subscription.endedAt?.toISOString() ?? null,
    outstanding: {
      amountMinor: outstandingMinor,
      currency: subscription.currency,
    },
    createdAt: subscription.createdAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString(),
  };
}

export function toSubscriptionActivity(
  activity: SubscriptionActivityRecord,
): SubscriptionActivity {
  return {
    id: activity.id,
    type: activity.type,
    message: activity.message,
    actorName: activity.actorName,
    createdAt: activity.createdAt.toISOString(),
  };
}
