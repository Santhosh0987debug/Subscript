import type {
  AnalyticsChurnResponse,
  AnalyticsCustomersResponse,
  AnalyticsInvoicesResponse,
  AnalyticsMrrResponse,
  AnalyticsOverviewResponse,
  AnalyticsPlansResponse,
  AnalyticsRevenueResponse,
  AnalyticsSubscriptionGrowthResponse,
} from "@subscript/shared";
import { API_PATHS } from "@subscript/shared";
import { Router, type RequestHandler } from "express";
import type { ResolvedAnalyticsQuery } from "./range.js";
import { resolveAnalyticsQuery } from "./range.js";
import type { AnalyticsStore } from "./types.js";
import {
  analyticsDetailQuerySchema,
  analyticsQuerySchema,
  type AnalyticsDetailQueryPayload,
  type AnalyticsQueryPayload,
} from "./validation.js";
import { buildRevenueCsv, buildSubscriptionCsv } from "./csv.js";
import { AppError } from "../errors/app-error.js";
import { parseQuery } from "../lib/validation.js";

export interface AnalyticsRouterOptions {
  analyticsStore: AnalyticsStore;
  authenticate: RequestHandler;
  requireOrganization: RequestHandler;
}

function resolve(query: AnalyticsQueryPayload | AnalyticsDetailQueryPayload): ResolvedAnalyticsQuery {
  return resolveAnalyticsQuery({
    from: query.from,
    to: query.to,
    timezone: query.timezone,
    grouping: query.grouping,
  });
}

function organizationId(res: Parameters<RequestHandler>[1]): string {
  const organization = res.locals.organization;

  if (!organization) {
    throw new AppError(403, "FORBIDDEN", "No active organization.");
  }

  return organization.id;
}

function attachment(res: Parameters<RequestHandler>[1], filename: string, body: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`,
  );
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(body);
}

export function createAnalyticsRouter(
  options: AnalyticsRouterOptions,
): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get(
    API_PATHS.analyticsOverview,
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const query = resolve(parseQuery(analyticsQuerySchema, req.query));
      const payload: AnalyticsOverviewResponse =
        await options.analyticsStore.getOverview(organizationId(res), query);

      res.status(200).json(payload);
    },
  );

  router.get(
    API_PATHS.analyticsRevenue,
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const query = resolve(parseQuery(analyticsQuerySchema, req.query));
      const payload: AnalyticsRevenueResponse =
        await options.analyticsStore.getRevenue(organizationId(res), query);

      res.status(200).json(payload);
    },
  );

  router.get(
    API_PATHS.analyticsMrr,
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const query = resolve(parseQuery(analyticsQuerySchema, req.query));
      const payload: AnalyticsMrrResponse =
        await options.analyticsStore.getMrrHistory(organizationId(res), query);

      res.status(200).json(payload);
    },
  );

  router.get(
    API_PATHS.analyticsSubscriptions,
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const query = resolve(parseQuery(analyticsQuerySchema, req.query));
      const payload: AnalyticsSubscriptionGrowthResponse =
        await options.analyticsStore.getSubscriptionGrowth(
          organizationId(res),
          query,
        );

      res.status(200).json(payload);
    },
  );

  router.get(
    API_PATHS.analyticsChurn,
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const query = resolve(parseQuery(analyticsQuerySchema, req.query));
      const payload: AnalyticsChurnResponse =
        await options.analyticsStore.getChurn(organizationId(res), query);

      res.status(200).json(payload);
    },
  );

  router.get(
    API_PATHS.analyticsCustomers,
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const query = parseQuery(analyticsDetailQuerySchema, req.query);
      const payload: AnalyticsCustomersResponse =
        await options.analyticsStore.getCustomers(
          organizationId(res),
          resolve(query),
          { page: query.page, pageSize: query.pageSize },
        );

      res.status(200).json(payload);
    },
  );

  router.get(
    API_PATHS.analyticsPlans,
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const query = parseQuery(analyticsDetailQuerySchema, req.query);
      const payload: AnalyticsPlansResponse = await options.analyticsStore.getPlans(
        organizationId(res),
        resolve(query),
        { page: query.page, pageSize: query.pageSize },
      );

      res.status(200).json(payload);
    },
  );

  router.get(
    API_PATHS.analyticsInvoices,
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const query = resolve(parseQuery(analyticsQuerySchema, req.query));
      const payload: AnalyticsInvoicesResponse =
        await options.analyticsStore.getInvoices(organizationId(res), query);

      res.status(200).json(payload);
    },
  );

  router.get(
    API_PATHS.analyticsRevenueCsv,
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const query = resolve(parseQuery(analyticsQuerySchema, req.query));
      const rows = await options.analyticsStore.getRevenueReportRows(
        organizationId(res),
        query,
      );

      attachment(
        res,
        `revenue-${query.fromDate}-to-${query.toDate}.csv`,
        buildRevenueCsv(rows),
      );
    },
  );

  router.get(
    API_PATHS.analyticsSubscriptionsCsv,
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const query = resolve(parseQuery(analyticsQuerySchema, req.query));
      const rows = await options.analyticsStore.getSubscriptionReportRows(
        organizationId(res),
        query,
      );

      attachment(
        res,
        `subscriptions-${query.fromDate}-to-${query.toDate}.csv`,
        buildSubscriptionCsv(rows),
      );
    },
  );

  return router;
}
