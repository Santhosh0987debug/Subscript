import type {
  AutomationJob,
  AutomationNotification,
  AutomationRenewal,
} from "@subscript/shared";
import type { SubscriptionRecord } from "../subscriptions/types.js";
import type {
  AutomationJobRecord,
  NotificationRecord,
} from "./types.js";

export function toAutomationJob(job: AutomationJobRecord): AutomationJob {
  return {
    id: job.id,
    type: job.type,
    queue: job.queue,
    status: job.status,
    targetType: job.targetType,
    targetId: job.targetId,
    runAt: job.runAt.toISOString(),
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError,
    resultSummary: job.resultSummary,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export function toAutomationNotification(
  notification: NotificationRecord,
): AutomationNotification {
  return {
    id: notification.id,
    type: notification.type,
    status: notification.status,
    recipientEmail: notification.recipientEmail,
    subject: notification.subject,
    attempts: notification.attempts,
    maxAttempts: notification.maxAttempts,
    lastError: notification.lastError,
    nextAttemptAt: notification.nextAttemptAt?.toISOString() ?? null,
    sentAt: notification.sentAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
  };
}

export function toAutomationRenewal(
  subscription: SubscriptionRecord,
): AutomationRenewal {
  const renewalDate =
    subscription.status === "TRIALING" && subscription.trialEndsAt
      ? subscription.trialEndsAt
      : subscription.currentPeriodEnd;

  return {
    subscriptionId: subscription.id,
    customerId: subscription.customerId,
    customerName: subscription.customerName,
    customerEmail: subscription.customerEmail,
    planName: subscription.planName,
    status: subscription.status,
    renewalDate: renewalDate.toISOString(),
    amount: {
      amountMinor: subscription.quantity * subscription.unitAmountMinor,
      currency: subscription.currency,
    },
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  };
}
