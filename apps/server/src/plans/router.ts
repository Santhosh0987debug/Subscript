import { Router, type RequestHandler } from "express";
import type {
  PlanListResponse,
  PlanResponse,
} from "@subscript/shared";
import { API_PATHS } from "@subscript/shared";
import { AppError } from "../errors/app-error.js";
import { parseBody, parseParams, parseQuery } from "../lib/validation.js";
import { toPlan } from "./serializer.js";
import {
  PlanCodeConflictError,
  PlanInUseError,
  type PlanRecord,
  type PlanStore,
  type PlanWriteFields,
} from "./types.js";
import {
  createPlanSchema,
  planIdParamsSchema,
  planListQuerySchema,
  updatePlanSchema,
} from "./validation.js";

const MAX_CODE_ATTEMPTS = 50;

export interface PlansRouterOptions {
  planStore: PlanStore;
  authenticate: RequestHandler;
  requireOrganization: RequestHandler;
  requireAdmin: RequestHandler;
}

function slugifyPlanName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

  return slug.length > 0 ? slug : "plan";
}

function samePlan(current: PlanRecord, next: PlanWriteFields): boolean {
  return (
    current.name === next.name &&
    current.description === next.description &&
    current.amountMinor === next.amountMinor &&
    current.currency === next.currency &&
    current.interval === next.interval &&
    current.trialDays === next.trialDays
  );
}

function planInUseError(subscriptionCount: number): AppError {
  return new AppError(
    409,
    "CONFLICT",
    `This plan is referenced by ${subscriptionCount} ${
      subscriptionCount === 1 ? "subscription" : "subscriptions"
    }. Archive it instead of deleting it.`,
  );
}

export function createPlansRouter(options: PlansRouterOptions): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get(
    API_PATHS.plans,
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const organization = res.locals.organization;

      if (!organization) {
        throw new AppError(403, "FORBIDDEN", "No active organization.");
      }

      const query = parseQuery(planListQuerySchema, req.query);
      const result = await options.planStore.list(organization.id, {
        search: query.query && query.query.length > 0 ? query.query : null,
        status: query.status,
        interval: query.interval,
        sort: query.sort,
        direction: query.direction,
        page: query.page,
        pageSize: query.pageSize,
      });
      const totalPages =
        result.total === 0 ? 0 : Math.ceil(result.total / query.pageSize);
      const payload: PlanListResponse = {
        plans: result.items.map(toPlan),
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages,
      };

      res.status(200).json(payload);
    },
  );

  router.post(
    API_PATHS.plans,
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    async (req, res) => {
      const organization = res.locals.organization;

      if (!organization) {
        throw new AppError(403, "FORBIDDEN", "No active organization.");
      }

      const payload = parseBody(createPlanSchema, req.body);
      const baseCode = slugifyPlanName(payload.name);
      let plan: PlanRecord | null = null;

      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
        const code = attempt === 0 ? baseCode : `${baseCode}-${attempt + 1}`;

        try {
          plan = await options.planStore.create({
            organizationId: organization.id,
            code,
            name: payload.name,
            description: payload.description ?? null,
            amountMinor: payload.price.amountMinor,
            currency: payload.price.currency,
            interval: payload.interval,
            trialDays: payload.trialDays,
          });
          break;
        } catch (error) {
          if (!(error instanceof PlanCodeConflictError)) {
            throw error;
          }
        }
      }

      if (!plan) {
        throw new AppError(
          409,
          "CONFLICT",
          "We could not generate a unique plan code. Try a different name.",
        );
      }

      const response: PlanResponse = { plan: toPlan(plan) };

      res.location(API_PATHS.plan(plan.id)).status(201).json(response);
    },
  );

  router.get(
    "/api/plans/:planId",
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const organization = res.locals.organization;

      if (!organization) {
        throw new AppError(403, "FORBIDDEN", "No active organization.");
      }

      const params = parseParams(planIdParamsSchema, req.params);
      const plan = await options.planStore.findById(
        organization.id,
        params.planId,
      );

      if (!plan) {
        throw new AppError(404, "NOT_FOUND", "That plan could not be found.");
      }

      const response: PlanResponse = { plan: toPlan(plan) };

      res.status(200).json(response);
    },
  );

  router.patch(
    "/api/plans/:planId",
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    async (req, res) => {
      const organization = res.locals.organization;

      if (!organization) {
        throw new AppError(403, "FORBIDDEN", "No active organization.");
      }

      const params = parseParams(planIdParamsSchema, req.params);
      const current = await options.planStore.findById(
        organization.id,
        params.planId,
      );

      if (!current) {
        throw new AppError(404, "NOT_FOUND", "That plan could not be found.");
      }

      const payload = parseBody(updatePlanSchema, req.body);
      const next: PlanWriteFields = {
        name: payload.name ?? current.name,
        description:
          payload.description !== undefined
            ? payload.description
            : current.description,
        amountMinor:
          payload.price !== undefined
            ? payload.price.amountMinor
            : current.amountMinor,
        currency:
          payload.price !== undefined
            ? payload.price.currency
            : current.currency,
        interval: payload.interval ?? current.interval,
        trialDays: payload.trialDays ?? current.trialDays,
      };

      if (samePlan(current, next)) {
        const response: PlanResponse = { plan: toPlan(current) };
        res.status(200).json(response);
        return;
      }

      const plan = await options.planStore.update(
        organization.id,
        current.id,
        next,
      );

      if (!plan) {
        throw new AppError(404, "NOT_FOUND", "That plan could not be found.");
      }

      const response: PlanResponse = { plan: toPlan(plan) };

      res.status(200).json(response);
    },
  );

  router.post(
    "/api/plans/:planId/archive",
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    async (req, res) => {
      const organization = res.locals.organization;

      if (!organization) {
        throw new AppError(403, "FORBIDDEN", "No active organization.");
      }

      const params = parseParams(planIdParamsSchema, req.params);
      const plan = await options.planStore.setStatus(
        organization.id,
        params.planId,
        "ARCHIVED",
      );

      if (!plan) {
        throw new AppError(404, "NOT_FOUND", "That plan could not be found.");
      }

      const response: PlanResponse = { plan: toPlan(plan) };

      res.status(200).json(response);
    },
  );

  router.post(
    "/api/plans/:planId/restore",
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    async (req, res) => {
      const organization = res.locals.organization;

      if (!organization) {
        throw new AppError(403, "FORBIDDEN", "No active organization.");
      }

      const params = parseParams(planIdParamsSchema, req.params);
      const plan = await options.planStore.setStatus(
        organization.id,
        params.planId,
        "ACTIVE",
      );

      if (!plan) {
        throw new AppError(404, "NOT_FOUND", "That plan could not be found.");
      }

      const response: PlanResponse = { plan: toPlan(plan) };

      res.status(200).json(response);
    },
  );

  router.delete(
    "/api/plans/:planId",
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    async (req, res) => {
      const organization = res.locals.organization;

      if (!organization) {
        throw new AppError(403, "FORBIDDEN", "No active organization.");
      }

      const params = parseParams(planIdParamsSchema, req.params);
      const plan = await options.planStore.findById(
        organization.id,
        params.planId,
      );

      if (!plan) {
        throw new AppError(404, "NOT_FOUND", "That plan could not be found.");
      }

      const subscriptionCount = await options.planStore.countSubscriptions(
        organization.id,
        plan.id,
      );

      if (subscriptionCount > 0) {
        throw planInUseError(subscriptionCount);
      }

      try {
        await options.planStore.delete(organization.id, plan.id);
      } catch (error) {
        if (error instanceof PlanInUseError) {
          const latestCount = await options.planStore.countSubscriptions(
            organization.id,
            plan.id,
          );
          throw planInUseError(Math.max(latestCount, 1));
        }

        throw error;
      }

      res.status(204).end();
    },
  );

  return router;
}
