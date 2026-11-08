import { Router, type RequestHandler, type Response } from "express";
import type {
  GenerateInvoiceResponse,
  SubscriptionActivityType,
  SubscriptionListResponse,
  SubscriptionMutationResponse,
  SubscriptionResponse,
} from "@subscript/shared";
import {
  API_PATHS,
  addBillingInterval,
  addUtcDays,
  formatIsoDate,
  parseIsoDate,
} from "@subscript/shared";
import type { AuthenticatedSession } from "../auth/types.js";
import {
  canGenerateInvoice,
  resolveSubscriptionTransition,
  type SubscriptionAction,
} from "../billing/lifecycle.js";
import { withBillingConflict } from "../billing/errors.js";
import type { CustomerStore } from "../customers/types.js";
import { AppError } from "../errors/app-error.js";
import { toInvoice, toInvoiceSummary, toPayment } from "../invoices/serializer.js";
import { generateInvoiceSchema } from "../invoices/validation.js";
import type { InvoiceStore } from "../invoices/types.js";
import { parseBody, parseParams, parseQuery } from "../lib/validation.js";
import type { PlanStore } from "../plans/types.js";
import { toSubscription, toSubscriptionActivity } from "./serializer.js";
import type {
  SubscriptionRecord,
  SubscriptionStore,
} from "./types.js";
import {
  cancelSubscriptionSchema,
  createSubscriptionSchema,
  subscriptionIdParamsSchema,
  subscriptionListQuerySchema,
} from "./validation.js";

const ACTIVITY_LIMIT = 100;

export interface SubscriptionsRouterOptions {
  subscriptionStore: SubscriptionStore;
  invoiceStore: InvoiceStore;
  customerStore: CustomerStore;
  planStore: PlanStore;
  authenticate: RequestHandler;
  requireOrganization: RequestHandler;
  requireAdmin: RequestHandler;
}

interface BillingActor {
  actorId: string | null;
  actorName: string | null;
}

function actor(res: Response): BillingActor {
  const authenticated = res.locals.auth as AuthenticatedSession | undefined;

  return {
    actorId: authenticated?.session.user.id ?? null,
    actorName: authenticated?.session.user.name ?? null,
  };
}

function organizationId(res: Response): string {
  const organization = res.locals.organization as
    | { id: string }
    | undefined;

  if (!organization) {
    throw new AppError(403, "FORBIDDEN", "No active organization.");
  }

  return organization.id;
}

function invalidDate(field: string, message: string): AppError {
  return new AppError(400, "VALIDATION_ERROR", "The request failed validation.", [
    { path: field, message },
  ]);
}

function archivedCustomerError(): AppError {
  return new AppError(
    409,
    "CONFLICT",
    "Archived customers cannot start a subscription. Restore the customer first.",
  );
}

function archivedPlanError(): AppError {
  return new AppError(
    409,
    "CONFLICT",
    "Archived plans cannot be subscribed to. Restore the plan or choose another.",
  );
}

function lifecycleActivity(
  action: SubscriptionAction,
  current: SubscriptionRecord,
  nextPeriodStart: Date,
  nextPeriodEnd: Date,
  atPeriodEnd: boolean | undefined,
): { type: SubscriptionActivityType; message: string } {
  switch (action) {
    case "pause":
      return { type: "PAUSED", message: "Paused this subscription." };
    case "resume":
      return { type: "RESUMED", message: "Resumed this subscription." };
    case "markPastDue":
      return {
        type: "PAST_DUE",
        message: "Marked this subscription past due.",
      };
    case "activate":
      return {
        type: "ACTIVATED",
        message: "Activated this subscription after outstanding invoices were settled.",
      };
    case "cancel":
      return atPeriodEnd === false
        ? {
            type: "CANCELED",
            message: "Canceled this subscription immediately.",
          }
        : {
            type: "CANCEL_SCHEDULED",
            message:
              "Scheduled cancellation for the end of the current billing period.",
          };
    case "renew":
      if (current.status === "TRIALING") {
        return {
          type: "ACTIVATED",
          message: "Converted the trial to an active subscription.",
        };
      }

      if (current.cancelAtPeriodEnd) {
        return {
          type: "CANCELED",
          message: "Ended this subscription at the end of its billing period.",
        };
      }

      return {
        type: "RENEWED",
        message: `Renewed for the period ${formatIsoDate(nextPeriodStart)} to ${formatIsoDate(nextPeriodEnd)}.`,
      };
    case "expire":
      return { type: "EXPIRED", message: "Expired this subscription." };
  }
}

export function createSubscriptionsRouter(
  options: SubscriptionsRouterOptions,
): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get(
    API_PATHS.subscriptions,
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const organization = organizationId(res);
      const query = parseQuery(subscriptionListQuerySchema, req.query);
      const result = await options.subscriptionStore.list(organization, {
        search: query.query && query.query.length > 0 ? query.query : null,
        status: query.status,
        sort: query.sort,
        direction: query.direction,
        page: query.page,
        pageSize: query.pageSize,
      });
      const outstanding = await options.invoiceStore.sumOutstandingBySubscriptions(
        organization,
        result.items.map((subscription) => subscription.id),
      );
      const totalPages =
        result.total === 0 ? 0 : Math.ceil(result.total / query.pageSize);
      const payload: SubscriptionListResponse = {
        subscriptions: result.items.map((subscription) =>
          toSubscription(subscription, outstanding.get(subscription.id) ?? 0),
        ),
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages,
      };

      res.status(200).json(payload);
    },
  );

  router.post(
    API_PATHS.subscriptions,
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    async (req, res) => {
      const organization = organizationId(res);
      const payload = parseBody(createSubscriptionSchema, req.body);
      const actorDetails = actor(res);
      const customer = await options.customerStore.findById(
        organization,
        payload.customerId,
      );

      if (!customer) {
        throw new AppError(404, "NOT_FOUND", "That customer could not be found.");
      }

      if (customer.status !== "ACTIVE") {
        throw archivedCustomerError();
      }

      const plan = await options.planStore.findById(organization, payload.planId);

      if (!plan) {
        throw new AppError(404, "NOT_FOUND", "That plan could not be found.");
      }

      if (plan.status !== "ACTIVE") {
        throw archivedPlanError();
      }

      const startDate = parseIsoDate(payload.startDate);

      if (!startDate) {
        throw invalidDate(
          "startDate",
          "Use a real calendar date in YYYY-MM-DD form.",
        );
      }

      const trialDays = payload.trialDays ?? plan.trialDays;
      const trialEndsAt =
        trialDays > 0 ? addUtcDays(startDate, trialDays) : null;
      const periodStart = trialEndsAt ?? startDate;
      let periodEnd: Date;

      if (payload.nextBillingDate) {
        const parsedEnd = parseIsoDate(payload.nextBillingDate);

        if (!parsedEnd) {
          throw invalidDate(
            "nextBillingDate",
            "Use a real calendar date in YYYY-MM-DD form.",
          );
        }

        if (parsedEnd.getTime() <= periodStart.getTime()) {
          throw invalidDate(
            "nextBillingDate",
            "Next billing date must be after the first paid period starts.",
          );
        }

        periodEnd = parsedEnd;
      } else {
        periodEnd = addBillingInterval(periodStart, plan.interval);
      }

      const subscription = await options.subscriptionStore.create({
        organizationId: organization,
        customerId: customer.id,
        customerName: customer.name,
        customerEmail: customer.email,
        planId: plan.id,
        planName: plan.name,
        planCode: plan.code,
        quantity: payload.quantity,
        unitAmountMinor: plan.amountMinor,
        currency: plan.currency,
        interval: plan.interval,
        trialDays,
        status: trialEndsAt ? "TRIALING" : "ACTIVE",
        startedAt: startDate,
        trialEndsAt,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        canceledAt: null,
        activity: {
          type: "CREATED",
          message: `Started this subscription on the ${plan.name} plan.`,
          ...actorDetails,
        },
        trialActivity: trialEndsAt
          ? {
              type: "TRIAL_STARTED",
              message: `Started a ${trialDays}-day trial ending ${formatIsoDate(trialEndsAt)}.`,
              ...actorDetails,
            }
          : null,
      });

      await options.planStore.recordSubscription?.(organization, plan.id);

      const response: SubscriptionMutationResponse = {
        subscription: toSubscription(subscription),
      };

      res
        .location(API_PATHS.subscription(subscription.id))
        .status(201)
        .json(response);
    },
  );

  router.get(
    "/api/subscriptions/:subscriptionId",
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const organization = organizationId(res);
      const params = parseParams(subscriptionIdParamsSchema, req.params);
      const subscription = await options.subscriptionStore.findById(
        organization,
        params.subscriptionId,
      );

      if (!subscription) {
        throw new AppError(
          404,
          "NOT_FOUND",
          "That subscription could not be found.",
        );
      }

      const [activities, invoices, payments, outstanding] = await Promise.all([
        options.subscriptionStore.listActivities(
          organization,
          subscription.id,
          ACTIVITY_LIMIT,
        ),
        options.invoiceStore.listBySubscription(organization, subscription.id),
        options.invoiceStore.listPaymentsForSubscription(
          organization,
          subscription.id,
        ),
        options.invoiceStore.sumOutstandingBySubscriptions(organization, [
          subscription.id,
        ]),
      ]);
      const response: SubscriptionResponse = {
        subscription: toSubscription(
          subscription,
          outstanding.get(subscription.id) ?? 0,
        ),
        activities: activities.map(toSubscriptionActivity),
        invoices: invoices.map(toInvoiceSummary),
        payments: payments.map(toPayment),
      };

      res.status(200).json(response);
    },
  );

  const lifecycleRoutes: ReadonlyArray<{
    path: string;
    action: SubscriptionAction;
  }> = [
    {
      path: "/api/subscriptions/:subscriptionId/pause",
      action: "pause",
    },
    {
      path: "/api/subscriptions/:subscriptionId/resume",
      action: "resume",
    },
    {
      path: "/api/subscriptions/:subscriptionId/cancel",
      action: "cancel",
    },
    {
      path: "/api/subscriptions/:subscriptionId/renew",
      action: "renew",
    },
    {
      path: "/api/subscriptions/:subscriptionId/expire",
      action: "expire",
    },
    {
      path: "/api/subscriptions/:subscriptionId/mark-past-due",
      action: "markPastDue",
    },
    {
      path: "/api/subscriptions/:subscriptionId/activate",
      action: "activate",
    },
  ];

  for (const route of lifecycleRoutes) {
    router.post(
      route.path,
      options.authenticate,
      options.requireOrganization,
      options.requireAdmin,
      async (req, res) => {
        const organization = organizationId(res);
        const params = parseParams(subscriptionIdParamsSchema, req.params);
        const atPeriodEnd =
          route.action === "cancel"
            ? parseBody(cancelSubscriptionSchema, req.body ?? {}).atPeriodEnd
            : undefined;
        const actorDetails = actor(res);
        const subscription = await options.subscriptionStore.findById(
          organization,
          params.subscriptionId,
        );

        if (!subscription) {
          throw new AppError(
            404,
            "NOT_FOUND",
            "That subscription could not be found.",
          );
        }

        const updated = await withBillingConflict(async () => {
          const transition = resolveSubscriptionTransition({
            status: subscription.status,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            action: route.action,
            ...(atPeriodEnd !== undefined ? { atPeriodEnd } : {}),
          });
          const now = new Date();
          let currentPeriodStart = subscription.currentPeriodStart;
          let currentPeriodEnd = subscription.currentPeriodEnd;

          if (transition.advancePeriod) {
            currentPeriodStart = subscription.currentPeriodEnd;
            currentPeriodEnd = addBillingInterval(
              subscription.currentPeriodEnd,
              subscription.interval,
            );
          }

          const nextBillingDate =
            transition.status === "TRIALING" && subscription.trialEndsAt
              ? subscription.trialEndsAt
              : currentPeriodEnd;
          const activityDetails = lifecycleActivity(
            route.action,
            subscription,
            currentPeriodStart,
            nextBillingDate,
            atPeriodEnd,
          );
          const becomingInactive =
            transition.status === "CANCELED" ||
            transition.status === "EXPIRED";

          return options.subscriptionStore.applyLifecycleChange(
            organization,
            subscription.id,
            {
              expectedStatus: subscription.status,
              expectedPeriodEnd: subscription.currentPeriodEnd,
              status: transition.status,
              currentPeriodStart,
              currentPeriodEnd,
              cancelAtPeriodEnd: transition.cancelAtPeriodEnd,
              canceledAt:
                transition.status === "CANCELED"
                  ? now
                  : subscription.canceledAt,
              pausedAt:
                route.action === "pause"
                  ? now
                  : route.action === "resume"
                    ? null
                    : subscription.pausedAt,
              endedAt: becomingInactive
                ? route.action === "renew" && subscription.cancelAtPeriodEnd
                  ? subscription.currentPeriodEnd
                  : now
                : subscription.endedAt,
              activity: {
                type: activityDetails.type,
                message: activityDetails.message,
                ...actorDetails,
              },
            },
          );
        });

        const outstanding =
          await options.invoiceStore.sumOutstandingBySubscriptions(
            organization,
            [updated.id],
          );
        const response: SubscriptionMutationResponse = {
          subscription: toSubscription(
            updated,
            outstanding.get(updated.id) ?? 0,
          ),
        };

        res.status(200).json(response);
      },
    );
  }

  router.post(
    "/api/subscriptions/:subscriptionId/invoices",
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    async (req, res) => {
      const organization = organizationId(res);
      const params = parseParams(subscriptionIdParamsSchema, req.params);
      const payload = parseBody(generateInvoiceSchema, req.body);
      const subscription = await options.subscriptionStore.findById(
        organization,
        params.subscriptionId,
      );

      if (!subscription) {
        throw new AppError(
          404,
          "NOT_FOUND",
          "That subscription could not be found.",
        );
      }

      if (!canGenerateInvoice(subscription.status)) {
        throw new AppError(
          409,
          "CONFLICT",
          `Invoices cannot be generated for a ${subscription.status} subscription.`,
        );
      }

      const customer = await options.customerStore.findById(
        organization,
        subscription.customerId,
      );

      if (!customer) {
        throw new AppError(
          409,
          "CONFLICT",
          "The customer for this subscription could not be found.",
        );
      }

      const result = await withBillingConflict(() =>
        options.invoiceStore.generate({
          organizationId: organization,
          subscriptionId: subscription.id,
          customerId: customer.id,
          customerName: customer.name,
          customerEmail: customer.email,
          customerCompany: customer.company,
          billingAddress: customer.billingAddress,
          periodStart: subscription.currentPeriodStart,
          periodEnd: subscription.currentPeriodEnd,
          quantity: subscription.quantity,
          unitAmountMinor: subscription.unitAmountMinor,
          currency: subscription.currency,
          lineDescription:
            payload.description ??
            `${subscription.planName} (${formatIsoDate(subscription.currentPeriodStart)} - ${formatIsoDate(subscription.currentPeriodEnd)})`,
          taxRateBps: payload.taxRateBps,
          dueInDays: payload.dueInDays,
          actor: actor(res),
        }),
      );
      const response: GenerateInvoiceResponse = {
        invoice: toInvoice(result.invoice),
        created: result.created,
      };

      res
        .location(API_PATHS.invoice(result.invoice.id))
        .status(result.created ? 201 : 200)
        .json(response);
    },
  );

  return router;
}
