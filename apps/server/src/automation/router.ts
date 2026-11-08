import { Router, type RequestHandler, type Response } from "express";
import type {
  AutomationDispatchResponse,
  AutomationHealth,
  AutomationJobListResponse,
  AutomationJobResponse,
  AutomationNotificationListResponse,
  AutomationNotificationResponse,
  AutomationOverviewResponse,
} from "@subscript/shared";
import { API_PATHS } from "@subscript/shared";
import { AppError } from "../errors/app-error.js";
import { parseParams, parseQuery } from "../lib/validation.js";
import type { SubscriptionStore } from "../subscriptions/types.js";
import type { NotificationService } from "./notifications/service.js";
import {
  toAutomationJob,
  toAutomationNotification,
  toAutomationRenewal,
} from "./serializer.js";
import type { AutomationService } from "./service.js";
import type { AutomationStore } from "./types.js";
import {
  automationJobListQuerySchema,
  automationJobParamsSchema,
  automationNotificationListQuerySchema,
  automationNotificationParamsSchema,
} from "./validation.js";

export interface AutomationRouterOptions {
  store: AutomationStore;
  service: AutomationService;
  notificationService: NotificationService;
  subscriptionStore: SubscriptionStore;
  health: () => Promise<AutomationHealth>;
  renewalWindowDays: number;
  authenticate: RequestHandler;
  requireOrganization: RequestHandler;
  requireAdmin: RequestHandler;
}

const RENEWAL_LIMIT = 25;
const DISPATCH_LIMIT = 200;

function organizationId(res: Response): string {
  const organization = res.locals.organization as { id?: unknown } | undefined;

  if (!organization || typeof organization.id !== "string") {
    throw new AppError(403, "FORBIDDEN", "No active organization.");
  }

  return organization.id;
}

export function createAutomationRouter(
  options: AutomationRouterOptions,
): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  const readGuards = [options.authenticate, options.requireOrganization];
  const writeGuards = [
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
  ];

  router.get(
    API_PATHS.automationOverview,
    ...readGuards,
    async (_req, res, next) => {
      try {
        const organization = organizationId(res);
        const now = new Date();
        const until = new Date(
          now.getTime() + options.renewalWindowDays * 86_400_000,
        );
        const [health, jobCounts, notificationCounts, renewals] =
          await Promise.all([
            options.health(),
            options.store.countJobs(organization),
            options.store.countNotifications(organization),
            options.subscriptionStore.listUpcomingRenewals(
              organization,
              now,
              until,
              RENEWAL_LIMIT,
            ),
          ]);

        const response: AutomationOverviewResponse = {
          health,
          summary: {
            pendingJobs: jobCounts.pending,
            runningJobs: jobCounts.running,
            failedJobs: jobCounts.failed,
            deadLetterJobs: jobCounts.deadLetter,
            pendingNotifications: notificationCounts.pending,
            failedNotifications:
              notificationCounts.failed + notificationCounts.deadLetter,
          },
          upcomingRenewals: renewals.map(toAutomationRenewal),
          renewalWindowDays: options.renewalWindowDays,
        };

        res.json(response);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    API_PATHS.automationJobs,
    ...readGuards,
    async (req, res, next) => {
      try {
        const organization = organizationId(res);
        const query = parseQuery(automationJobListQuerySchema, req.query);
        const [result, counts] = await Promise.all([
          options.store.listJobs(organization, query),
          options.store.countJobs(organization),
        ]);
        const response: AutomationJobListResponse = {
          jobs: result.items.map(toAutomationJob),
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
          totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)),
          counts,
        };

        res.json(response);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/api/automation/jobs/:jobId/retry",
    ...writeGuards,
    async (req, res, next) => {
      try {
        const organization = organizationId(res);
        const params = parseParams(automationJobParamsSchema, req.params);
        const job = await options.service.retryJob(
          organization,
          params.jobId,
        );

        if (!job) {
          throw new AppError(
            404,
            "NOT_FOUND",
            "No retryable automation job was found.",
          );
        }

        const response: AutomationJobResponse = {
          job: toAutomationJob(job),
        };
        res.json(response);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    API_PATHS.automationNotifications,
    ...readGuards,
    async (req, res, next) => {
      try {
        const organization = organizationId(res);
        const query = parseQuery(
          automationNotificationListQuerySchema,
          req.query,
        );
        const [result, counts] = await Promise.all([
          options.store.listNotifications(organization, query),
          options.store.countNotifications(organization),
        ]);
        const response: AutomationNotificationListResponse = {
          notifications: result.items.map(toAutomationNotification),
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
          totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)),
          counts,
        };

        res.json(response);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/api/automation/notifications/:notificationId/retry",
    ...writeGuards,
    async (req, res, next) => {
      try {
        const organization = organizationId(res);
        const params = parseParams(
          automationNotificationParamsSchema,
          req.params,
        );
        const notification = await options.notificationService.retry(
          organization,
          params.notificationId,
          new Date(),
        );

        if (!notification) {
          throw new AppError(
            404,
            "NOT_FOUND",
            "No retryable notification was found.",
          );
        }

        const response: AutomationNotificationResponse = {
          notification: toAutomationNotification(notification),
        };
        res.json(response);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    API_PATHS.automationDispatch,
    ...writeGuards,
    async (_req, res, next) => {
      try {
        const organization = organizationId(res);
        const queued = await options.service.dispatchOutbox(
          organization,
          new Date(),
          DISPATCH_LIMIT,
        );
        const response: AutomationDispatchResponse = {
          queuedJobs: queued.queuedJobs,
          queuedNotifications: queued.queuedNotifications,
        };

        res.json(response);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
