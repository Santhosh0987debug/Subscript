import type {
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client.js";
import { SubscriptionStateConflictError } from "../../billing/errors.js";
import type {
  CreateSubscriptionInput,
  SubscriptionActivityRecord,
  SubscriptionListOptions,
  SubscriptionListResult,
  SubscriptionRecord,
  SubscriptionStore,
} from "../types.js";

const subscriptionInclude = {
  customer: { select: { name: true, email: true } },
} satisfies Prisma.SubscriptionInclude;

type SubscriptionRow = Prisma.SubscriptionGetPayload<{
  include: typeof subscriptionInclude;
}>;

function mapSubscription(subscription: SubscriptionRow): SubscriptionRecord {
  return {
    id: subscription.id,
    organizationId: subscription.organizationId,
    customerId: subscription.customerId,
    customerName: subscription.customer.name,
    customerEmail: subscription.customer.email,
    planId: subscription.planId,
    planName: subscription.planName,
    planCode: subscription.planCode,
    status: subscription.status,
    quantity: subscription.quantity,
    unitAmountMinor: subscription.unitAmountMinor,
    currency: subscription.currency,
    interval: subscription.interval,
    trialDays: subscription.trialDays,
    startedAt: subscription.startedAt,
    trialEndsAt: subscription.trialEndsAt,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    canceledAt: subscription.canceledAt,
    pausedAt: subscription.pausedAt,
    endedAt: subscription.endedAt,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  };
}

function orderBy(
  options: SubscriptionListOptions,
): Prisma.SubscriptionOrderByWithRelationInput {
  switch (options.sort) {
    case "customer":
      return { customer: { name: options.direction } };
    case "plan":
      return { planName: options.direction };
    case "nextBillingDate":
      return { currentPeriodEnd: options.direction };
    default:
      return { [options.sort]: options.direction };
  }
}

function activityData(
  input: CreateSubscriptionInput["activity"],
  organizationId: string,
  subscriptionId: string,
) {
  return {
    organizationId,
    subscriptionId,
    type: input.type,
    message: input.message,
    actorId: input.actorId,
    actorName: input.actorName,
  };
}

export function createPrismaSubscriptionStore(
  prisma: PrismaClient,
): SubscriptionStore {
  return {
    async list(
      organizationId,
      options: SubscriptionListOptions,
    ): Promise<SubscriptionListResult> {
      const where: Prisma.SubscriptionWhereInput = {
        organizationId,
        ...(options.status === "ALL" ? {} : { status: options.status }),
        ...(options.search
          ? {
              OR: [
                {
                  customer: {
                    name: {
                      contains: options.search,
                      mode: "insensitive",
                    },
                  },
                },
                {
                  customer: {
                    email: {
                      contains: options.search,
                      mode: "insensitive",
                    },
                  },
                },
                {
                  planName: {
                    contains: options.search,
                    mode: "insensitive",
                  },
                },
                {
                  planCode: {
                    contains: options.search,
                    mode: "insensitive",
                  },
                },
              ],
            }
          : {}),
      };
      const skip = (options.page - 1) * options.pageSize;
      const [items, total] = await prisma.$transaction([
        prisma.subscription.findMany({
          where,
          include: subscriptionInclude,
          orderBy: [orderBy(options), { id: "asc" }],
          skip,
          take: options.pageSize,
        }),
        prisma.subscription.count({ where }),
      ]);

      return { items: items.map(mapSubscription), total };
    },

    async findById(organizationId, subscriptionId) {
      const subscription = await prisma.subscription.findFirst({
        where: { id: subscriptionId, organizationId },
        include: subscriptionInclude,
      });

      return subscription ? mapSubscription(subscription) : null;
    },

    async create(input: CreateSubscriptionInput) {
      return prisma.$transaction(async (tx) => {
        const subscription = await tx.subscription.create({
          data: {
            organizationId: input.organizationId,
            customerId: input.customerId,
            planId: input.planId,
            status: input.status,
            quantity: input.quantity,
            startedAt: input.startedAt,
            trialEndsAt: input.trialEndsAt,
            currentPeriodStart: input.currentPeriodStart,
            currentPeriodEnd: input.currentPeriodEnd,
            canceledAt: input.canceledAt,
            planName: input.planName,
            planCode: input.planCode,
            unitAmountMinor: input.unitAmountMinor,
            currency: input.currency,
            interval: input.interval,
            trialDays: input.trialDays,
          },
          include: subscriptionInclude,
        });

        await tx.subscriptionActivity.create({
          data: activityData(
            input.activity,
            input.organizationId,
            subscription.id,
          ),
        });

        if (input.trialActivity) {
          await tx.subscriptionActivity.create({
            data: activityData(
              input.trialActivity,
              input.organizationId,
              subscription.id,
            ),
          });
        }

        return mapSubscription(subscription);
      });
    },

    async listUpcomingRenewals(organizationId, from, until, limit) {
      const [trialing, active] = await Promise.all([
        prisma.subscription.findMany({
          where: {
            organizationId,
            status: "TRIALING",
            trialEndsAt: { gte: from, lte: until },
          },
          include: subscriptionInclude,
          orderBy: { trialEndsAt: "asc" },
          take: limit,
        }),
        prisma.subscription.findMany({
          where: {
            organizationId,
            status: "ACTIVE",
            currentPeriodEnd: { gte: from, lte: until },
          },
          include: subscriptionInclude,
          orderBy: { currentPeriodEnd: "asc" },
          take: limit,
        }),
      ]);

      return [...trialing, ...active]
        .map(mapSubscription)
        .map((subscription) => ({
          subscription,
          renewalDate:
            subscription.status === "TRIALING" &&
            subscription.trialEndsAt !== null
              ? subscription.trialEndsAt
              : subscription.currentPeriodEnd,
        }))
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
      change,
    ) {
      return prisma.$transaction(async (tx) => {
        const updated = await tx.subscription.updateMany({
          where: {
            id: subscriptionId,
            organizationId,
            status: change.expectedStatus,
            currentPeriodEnd: change.expectedPeriodEnd,
          },
          data: {
            status: change.status,
            currentPeriodStart: change.currentPeriodStart,
            currentPeriodEnd: change.currentPeriodEnd,
            cancelAtPeriodEnd: change.cancelAtPeriodEnd,
            canceledAt: change.canceledAt,
            pausedAt: change.pausedAt,
            endedAt: change.endedAt,
          },
        });

        if (updated.count === 0) {
          throw new SubscriptionStateConflictError();
        }

        await tx.subscriptionActivity.create({
          data: activityData(
            change.activity,
            organizationId,
            subscriptionId,
          ),
        });

        const subscription = await tx.subscription.findUniqueOrThrow({
          where: { id: subscriptionId },
          include: subscriptionInclude,
        });

        return mapSubscription(subscription);
      });
    },

    async listActivities(organizationId, subscriptionId, limit) {
      const activities = await prisma.subscriptionActivity.findMany({
        where: { organizationId, subscriptionId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      return activities.map(
        (activity): SubscriptionActivityRecord => ({
          id: activity.id,
          type: activity.type,
          message: activity.message,
          actorName: activity.actorName,
          createdAt: activity.createdAt,
        }),
      );
    },
  };
}
