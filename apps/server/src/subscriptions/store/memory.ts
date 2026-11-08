import { randomUUID } from "node:crypto";
import type { SubscriptionSortField } from "@subscript/shared";
import { SubscriptionStateConflictError } from "../../billing/errors.js";
import type {
  CreateSubscriptionInput,
  SubscriptionActivityInput,
  SubscriptionActivityRecord,
  SubscriptionLifecycleChange,
  SubscriptionListOptions,
  SubscriptionListResult,
  SubscriptionRecord,
  SubscriptionStore,
} from "../types.js";

interface MemoryActivity extends SubscriptionActivityRecord {
  organizationId: string;
  subscriptionId: string;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

function compareSubscriptions(
  left: SubscriptionRecord,
  right: SubscriptionRecord,
  sort: SubscriptionSortField,
): number {
  switch (sort) {
    case "customer":
      return compareText(left.customerName, right.customerName);
    case "plan":
      return compareText(left.planName, right.planName);
    case "status":
      return compareText(left.status, right.status);
    case "nextBillingDate":
      return left.currentPeriodEnd.getTime() - right.currentPeriodEnd.getTime();
    case "createdAt":
      return left.createdAt.getTime() - right.createdAt.getTime();
  }
}

function matchesSearch(
  subscription: SubscriptionRecord,
  search: string,
): boolean {
  return [
    subscription.customerName,
    subscription.customerEmail,
    subscription.planName,
    subscription.planCode,
  ]
    .join(" ")
    .toLowerCase()
    .includes(search);
}

export function createMemorySubscriptionStore(): SubscriptionStore {
  const subscriptions = new Map<string, SubscriptionRecord>();
  const activities: MemoryActivity[] = [];

  function findScoped(
    organizationId: string,
    subscriptionId: string,
  ): SubscriptionRecord | null {
    const subscription = subscriptions.get(subscriptionId);

    return subscription?.organizationId === organizationId
      ? subscription
      : null;
  }

  function recordActivity(
    organizationId: string,
    subscriptionId: string,
    activity: SubscriptionActivityInput,
  ): void {
    activities.push({
      id: randomUUID(),
      organizationId,
      subscriptionId,
      type: activity.type,
      message: activity.message,
      actorName: activity.actorName,
      createdAt: new Date(),
    });
  }

  return {
    async list(
      organizationId,
      options: SubscriptionListOptions,
    ): Promise<SubscriptionListResult> {
      const search = options.search?.toLowerCase() ?? null;
      const filtered = [...subscriptions.values()].filter(
        (subscription) =>
          subscription.organizationId === organizationId &&
          (options.status === "ALL" ||
            subscription.status === options.status) &&
          (!search || matchesSearch(subscription, search)),
      );
      const direction = options.direction === "asc" ? 1 : -1;

      filtered.sort(
        (left, right) =>
          compareSubscriptions(left, right, options.sort) * direction ||
          left.id.localeCompare(right.id),
      );

      const start = (options.page - 1) * options.pageSize;

      return {
        items: filtered.slice(start, start + options.pageSize),
        total: filtered.length,
      };
    },

    async findById(organizationId, subscriptionId) {
      return findScoped(organizationId, subscriptionId);
    },

    async create(input: CreateSubscriptionInput) {
      const now = new Date();
      const subscription: SubscriptionRecord = {
        id: randomUUID(),
        organizationId: input.organizationId,
        customerId: input.customerId,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        planId: input.planId,
        planName: input.planName,
        planCode: input.planCode,
        status: input.status,
        quantity: input.quantity,
        unitAmountMinor: input.unitAmountMinor,
        currency: input.currency,
        interval: input.interval,
        trialDays: input.trialDays,
        startedAt: input.startedAt,
        trialEndsAt: input.trialEndsAt,
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        cancelAtPeriodEnd: false,
        canceledAt: input.canceledAt,
        pausedAt: null,
        endedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      subscriptions.set(subscription.id, subscription);
      recordActivity(input.organizationId, subscription.id, input.activity);

      if (input.trialActivity) {
        recordActivity(
          input.organizationId,
          subscription.id,
          input.trialActivity,
        );
      }

      return subscription;
    },

    async listUpcomingRenewals(organizationId, from, until, limit) {
      return [...subscriptions.values()]
        .filter(
          (subscription) =>
            subscription.organizationId === organizationId &&
            (subscription.status === "ACTIVE" ||
              subscription.status === "TRIALING"),
        )
        .map((subscription) => ({
          subscription,
          renewalDate:
            subscription.status === "TRIALING" &&
            subscription.trialEndsAt !== null
              ? subscription.trialEndsAt
              : subscription.currentPeriodEnd,
        }))
        .filter(
          ({ renewalDate }) =>
            renewalDate.getTime() >= from.getTime() &&
            renewalDate.getTime() <= until.getTime(),
        )
        .sort(
          (left, right) =>
            left.renewalDate.getTime() - right.renewalDate.getTime() ||
            left.subscription.id.localeCompare(right.subscription.id),
        )
        .slice(0, limit)
        .map(({ subscription }) => subscription);
    },

    async applyLifecycleChange(
      organizationId,
      subscriptionId,
      change: SubscriptionLifecycleChange,
    ) {
      const subscription = findScoped(organizationId, subscriptionId);

      if (!subscription) {
        throw new SubscriptionStateConflictError(
          "That subscription could not be found.",
        );
      }

      if (
        subscription.status !== change.expectedStatus ||
        subscription.currentPeriodEnd.getTime() !==
          change.expectedPeriodEnd.getTime()
      ) {
        throw new SubscriptionStateConflictError();
      }

      Object.assign(subscription, {
        status: change.status,
        currentPeriodStart: change.currentPeriodStart,
        currentPeriodEnd: change.currentPeriodEnd,
        cancelAtPeriodEnd: change.cancelAtPeriodEnd,
        canceledAt: change.canceledAt,
        pausedAt: change.pausedAt,
        endedAt: change.endedAt,
        updatedAt: new Date(),
      });
      recordActivity(organizationId, subscriptionId, change.activity);

      return subscription;
    },

    async listActivities(organizationId, subscriptionId, limit) {
      if (!findScoped(organizationId, subscriptionId)) {
        return [];
      }

      return activities
        .filter(
          (activity) =>
            activity.organizationId === organizationId &&
            activity.subscriptionId === subscriptionId,
        )
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime(),
        )
        .slice(0, limit)
        .map(({ id, type, message, actorName, createdAt }) => ({
          id,
          type,
          message,
          actorName,
          createdAt,
        }));
    },
  };
}
