import type {
  Plan,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client.js";
import {
  PlanCodeConflictError,
  PlanInUseError,
  type CreatePlanInput,
  type PlanListOptions,
  type PlanListResult,
  type PlanRecord,
  type PlanStore,
  type PlanWriteFields,
} from "../types.js";

const subscriptionCountSelection = {
  _count: { select: { subscriptions: true } },
} satisfies Prisma.PlanInclude;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2003"
  );
}

function mapPlan(
  plan: Plan,
  subscriptionCount: number,
): PlanRecord {
  return {
    id: plan.id,
    organizationId: plan.organizationId,
    name: plan.name,
    code: plan.code,
    description: plan.description,
    amountMinor: plan.amountMinor,
    currency: plan.currency,
    interval: plan.interval,
    trialDays: plan.trialDays,
    status: plan.status,
    subscriptionCount,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

function orderBy(options: PlanListOptions): Prisma.PlanOrderByWithRelationInput {
  const field = options.sort === "price" ? "amountMinor" : options.sort;

  return { [field]: options.direction } as Prisma.PlanOrderByWithRelationInput;
}

function planColumns(fields: PlanWriteFields) {
  return {
    name: fields.name,
    description: fields.description,
    amountMinor: fields.amountMinor,
    currency: fields.currency,
    interval: fields.interval,
    trialDays: fields.trialDays,
  };
}

export function createPrismaPlanStore(prisma: PrismaClient): PlanStore {
  return {
    async list(
      organizationId,
      options: PlanListOptions,
    ): Promise<PlanListResult> {
      const where: Prisma.PlanWhereInput = {
        organizationId,
        ...(options.status === "ALL" ? {} : { status: options.status }),
        ...(options.interval === "ALL"
          ? {}
          : { interval: options.interval }),
        ...(options.search
          ? {
              OR: [
                {
                  name: {
                    contains: options.search,
                    mode: "insensitive",
                  },
                },
                {
                  code: {
                    contains: options.search,
                    mode: "insensitive",
                  },
                },
                {
                  description: {
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
        prisma.plan.findMany({
          where,
          include: subscriptionCountSelection,
          orderBy: [orderBy(options), { id: "asc" }],
          skip,
          take: options.pageSize,
        }),
        prisma.plan.count({ where }),
      ]);

      return {
        items: items.map((plan) =>
          mapPlan(plan, plan._count.subscriptions),
        ),
        total,
      };
    },

    async findById(organizationId, planId) {
      const plan = await prisma.plan.findFirst({
        where: { id: planId, organizationId },
        include: subscriptionCountSelection,
      });

      return plan ? mapPlan(plan, plan._count.subscriptions) : null;
    },

    async findByCode(organizationId, code) {
      const plan = await prisma.plan.findFirst({
        where: {
          organizationId,
          code: { equals: code, mode: "insensitive" },
        },
        include: subscriptionCountSelection,
      });

      return plan ? mapPlan(plan, plan._count.subscriptions) : null;
    },

    async create(input: CreatePlanInput) {
      try {
        const plan = await prisma.plan.create({
          data: {
            organizationId: input.organizationId,
            code: input.code,
            ...planColumns(input),
          },
          include: subscriptionCountSelection,
        });

        return mapPlan(plan, plan._count.subscriptions);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new PlanCodeConflictError();
        }

        throw error;
      }
    },

    async update(
      organizationId,
      planId,
      fields: PlanWriteFields,
    ) {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.plan.findFirst({
          where: { id: planId, organizationId },
        });

        if (!existing) {
          return null;
        }

        const plan = await tx.plan.update({
          where: { id: existing.id },
          data: planColumns(fields),
          include: subscriptionCountSelection,
        });

        return mapPlan(plan, plan._count.subscriptions);
      });
    },

    async setStatus(organizationId, planId, status) {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.plan.findFirst({
          where: { id: planId, organizationId },
        });

        if (!existing) {
          return null;
        }

        if (existing.status === status) {
          const plan = await tx.plan.findUniqueOrThrow({
            where: { id: existing.id },
            include: subscriptionCountSelection,
          });

          return mapPlan(plan, plan._count.subscriptions);
        }

        const plan = await tx.plan.update({
          where: { id: existing.id },
          data: { status },
          include: subscriptionCountSelection,
        });

        return mapPlan(plan, plan._count.subscriptions);
      });
    },

    async delete(organizationId, planId) {
      try {
        return await prisma.$transaction(async (tx) => {
          const plan = await tx.plan.findFirst({
            where: { id: planId, organizationId },
            include: subscriptionCountSelection,
          });

          if (!plan) {
            return false;
          }

          if (plan._count.subscriptions > 0) {
            throw new PlanInUseError();
          }

          await tx.plan.delete({ where: { id: plan.id } });
          return true;
        });
      } catch (error) {
        if (isForeignKeyViolation(error) || error instanceof PlanInUseError) {
          throw new PlanInUseError();
        }

        throw error;
      }
    },

    async countSubscriptions(organizationId, planId) {
      return prisma.subscription.count({
        where: { organizationId, planId },
      });
    },
  };
}
