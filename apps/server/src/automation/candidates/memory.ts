import type {
  AutomationCandidateSource,
  AutomationPaymentFailureCandidate,
  AutomationPaymentSucceededEvent,
  AutomationRefundEvent,
  AutomationSubscriptionCandidate,
} from "../types.js";

export interface MemoryAutomationCandidateSource extends AutomationCandidateSource {
  registerOrganization(organizationId: string, name?: string): void;
  seedSubscription(candidate: AutomationSubscriptionCandidate): void;
  seedFailedPayment(candidate: AutomationPaymentFailureCandidate): void;
  seedSucceededPayment(event: AutomationPaymentSucceededEvent): void;
  seedRefundUpdate(event: AutomationRefundEvent): void;
  clear(): void;
}

export function createMemoryAutomationCandidateSource(): MemoryAutomationCandidateSource {
  const organizationNames = new Map<string, string>();
  let subscriptions: AutomationSubscriptionCandidate[] = [];
  let failedPayments: AutomationPaymentFailureCandidate[] = [];
  let succeededPayments: AutomationPaymentSucceededEvent[] = [];
  let refundUpdates: AutomationRefundEvent[] = [];

  return {
    registerOrganization(organizationId, name = "Test Organization") {
      organizationNames.set(organizationId, name);
    },

    seedSubscription(candidate) {
      organizationNames.set(candidate.organizationId, candidate.organizationName);
      subscriptions = subscriptions.filter(
        (existing) => existing.subscriptionId !== candidate.subscriptionId,
      );
      subscriptions.push(candidate);
    },

    seedFailedPayment(candidate) {
      organizationNames.set(candidate.organizationId, candidate.organizationName);
      failedPayments = failedPayments.filter(
        (existing) => existing.paymentId !== candidate.paymentId,
      );
      failedPayments.push(candidate);
    },

    seedSucceededPayment(event) {
      organizationNames.set(event.organizationId, event.organizationName);
      succeededPayments = succeededPayments.filter(
        (existing) => existing.paymentId !== event.paymentId,
      );
      succeededPayments.push(event);
    },

    seedRefundUpdate(event) {
      organizationNames.set(event.organizationId, event.organizationName);
      refundUpdates = refundUpdates.filter(
        (existing) => existing.refundId !== event.refundId,
      );
      refundUpdates.push(event);
    },

    clear() {
      organizationNames.clear();
      subscriptions = [];
      failedPayments = [];
      succeededPayments = [];
      refundUpdates = [];
    },

    async listOrganizationIds() {
      return [...organizationNames.keys()];
    },

    async getOrganizationName(organizationId) {
      return organizationNames.get(organizationId) ?? null;
    },

    async listSubscriptionsForAutomation(organizationId) {
      return subscriptions.filter(
        (candidate) => candidate.organizationId === organizationId,
      );
    },

    async listFailedPayments(organizationId, since) {
      return failedPayments.filter(
        (candidate) =>
          candidate.organizationId === organizationId &&
          candidate.failedAt.getTime() >= since.getTime(),
      );
    },

    async listRecentSucceededPayments(organizationId, since) {
      return succeededPayments.filter(
        (event) =>
          event.organizationId === organizationId &&
          event.paidAt.getTime() >= since.getTime(),
      );
    },

    async listRecentRefundUpdates(organizationId, since) {
      return refundUpdates.filter(
        (event) =>
          event.organizationId === organizationId &&
          event.updatedAt.getTime() >= since.getTime(),
      );
    },
  };
}
