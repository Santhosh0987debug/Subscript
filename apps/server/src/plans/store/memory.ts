import { randomUUID } from "node:crypto";
import type { PlanSortField, PlanStatus } from "@subscript/shared";
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

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

function comparePlans(
  left: PlanRecord,
  right: PlanRecord,
  sort: PlanSortField,
): number {
  switch (sort) {
    case "name":
      return compareText(left.name, right.name);
    case "price":
      return left.amountMinor - right.amountMinor;
    case "interval":
      return compareText(left.interval, right.interval);
    case "trialDays":
      return left.trialDays - right.trialDays;
    case "status":
      return compareText(left.status, right.status);
    case "createdAt":
      return left.createdAt.getTime() - right.createdAt.getTime();
    case "updatedAt":
      return left.updatedAt.getTime() - right.updatedAt.getTime();
  }
}

function matchesSearch(plan: PlanRecord, search: string): boolean {
  const haystack = [
    plan.name,
    plan.code,
    plan.description ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(search);
}

export interface MemoryPlanStore extends PlanStore {
  /**
   * Test and local-preview helper. Subscriptions arrive in a later phase, so
   * this records the reference that protects a plan from deletion.
   */
  addSubscriptionReference(organizationId: string, planId: string): void;
}

export function createMemoryPlanStore(): MemoryPlanStore {
  const plans = new Map<string, PlanRecord>();

  function findScoped(
    organizationId: string,
    planId: string,
  ): PlanRecord | null {
    const plan = plans.get(planId);

    return plan?.organizationId === organizationId ? plan : null;
  }

  function findPlanByCode(
    organizationId: string,
    code: string,
  ): PlanRecord | null {
    const normalized = code.toLowerCase();

    return (
      [...plans.values()].find(
        (plan) =>
          plan.organizationId === organizationId &&
          plan.code.toLowerCase() === normalized,
      ) ?? null
    );
  }

  return {
    async list(
      organizationId,
      options: PlanListOptions,
    ): Promise<PlanListResult> {
      const search = options.search?.toLowerCase() ?? null;
      const filtered = [...plans.values()].filter(
        (plan) =>
          plan.organizationId === organizationId &&
          (options.status === "ALL" || plan.status === options.status) &&
          (options.interval === "ALL" || plan.interval === options.interval) &&
          (!search || matchesSearch(plan, search)),
      );
      const direction = options.direction === "asc" ? 1 : -1;

      filtered.sort(
        (left, right) =>
          comparePlans(left, right, options.sort) * direction ||
          left.id.localeCompare(right.id),
      );

      const start = (options.page - 1) * options.pageSize;

      return {
        items: filtered.slice(start, start + options.pageSize),
        total: filtered.length,
      };
    },

    async findById(organizationId, planId) {
      return findScoped(organizationId, planId);
    },

    async findByCode(organizationId, code) {
      return findPlanByCode(organizationId, code);
    },

    async create(input: CreatePlanInput) {
      if (findPlanByCode(input.organizationId, input.code)) {
        throw new PlanCodeConflictError();
      }

      const now = new Date();
      const plan: PlanRecord = {
        id: randomUUID(),
        organizationId: input.organizationId,
        name: input.name,
        code: input.code,
        description: input.description,
        amountMinor: input.amountMinor,
        currency: input.currency,
        interval: input.interval,
        trialDays: input.trialDays,
        status: "ACTIVE",
        subscriptionCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      plans.set(plan.id, plan);
      return plan;
    },

    async update(
      organizationId,
      planId,
      fields: PlanWriteFields,
    ) {
      const plan = findScoped(organizationId, planId);

      if (!plan) {
        return null;
      }

      Object.assign(plan, fields, { updatedAt: new Date() });
      return plan;
    },

    async setStatus(organizationId, planId, status: PlanStatus) {
      const plan = findScoped(organizationId, planId);

      if (!plan) {
        return null;
      }

      if (plan.status !== status) {
        plan.status = status;
        plan.updatedAt = new Date();
      }

      return plan;
    },

    async delete(organizationId, planId) {
      const plan = findScoped(organizationId, planId);

      if (!plan) {
        return false;
      }

      if (plan.subscriptionCount > 0) {
        throw new PlanInUseError();
      }

      plans.delete(planId);
      return true;
    },

    async countSubscriptions(organizationId, planId) {
      return findScoped(organizationId, planId)?.subscriptionCount ?? 0;
    },

    addSubscriptionReference(organizationId, planId) {
      const plan = findScoped(organizationId, planId);

      if (!plan) {
        throw new Error(`Memory store is missing plan ${planId}.`);
      }

      plan.subscriptionCount += 1;
    },
  };
}
