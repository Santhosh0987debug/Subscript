import { Router, type RequestHandler, type Response } from "express";
import type {
  InvoiceListResponse,
  InvoiceResponse,
  PaymentActionResponse,
} from "@subscript/shared";
import { API_PATHS } from "@subscript/shared";
import type { AuthenticatedSession } from "../auth/types.js";
import { withBillingConflict } from "../billing/errors.js";
import { AppError } from "../errors/app-error.js";
import { parseBody, parseParams, parseQuery } from "../lib/validation.js";
import {
  toInvoice,
  toInvoiceSummary,
  toPayment,
} from "./serializer.js";
import type { InvoiceStore } from "./types.js";
import {
  invoiceIdParamsSchema,
  invoiceListQuerySchema,
  paymentIdParamsSchema,
  recordPaymentSchema,
} from "./validation.js";

export interface InvoicesRouterOptions {
  invoiceStore: InvoiceStore;
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

export function createInvoicesRouter(
  options: InvoicesRouterOptions,
): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get(
    API_PATHS.invoices,
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const organization = organizationId(res);
      const query = parseQuery(invoiceListQuerySchema, req.query);
      const result = await options.invoiceStore.list(organization, {
        search: query.query && query.query.length > 0 ? query.query : null,
        status: query.status,
        subscriptionId: query.subscriptionId ?? null,
        customerId: query.customerId ?? null,
        sort: query.sort,
        direction: query.direction,
        page: query.page,
        pageSize: query.pageSize,
      });
      const totalPages =
        result.total === 0 ? 0 : Math.ceil(result.total / query.pageSize);
      const payload: InvoiceListResponse = {
        invoices: result.items.map(toInvoiceSummary),
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages,
      };

      res.status(200).json(payload);
    },
  );

  router.get(
    "/api/invoices/:invoiceId",
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const organization = organizationId(res);
      const params = parseParams(invoiceIdParamsSchema, req.params);
      const invoice = await options.invoiceStore.findById(
        organization,
        params.invoiceId,
      );

      if (!invoice) {
        throw new AppError(404, "NOT_FOUND", "That invoice could not be found.");
      }

      const response: InvoiceResponse = { invoice: toInvoice(invoice) };

      res.status(200).json(response);
    },
  );

  const invoiceActions = [
    { path: "/api/invoices/:invoiceId/issue", action: "issue" },
    { path: "/api/invoices/:invoiceId/void", action: "void" },
    {
      path: "/api/invoices/:invoiceId/mark-uncollectible",
      action: "markUncollectible",
    },
  ] as const;

  for (const route of invoiceActions) {
    router.post(
      route.path,
      options.authenticate,
      options.requireOrganization,
      options.requireAdmin,
      async (req, res) => {
        const organization = organizationId(res);
        const params = parseParams(invoiceIdParamsSchema, req.params);
        const invoice = await options.invoiceStore.findById(
          organization,
          params.invoiceId,
        );

        if (!invoice) {
          throw new AppError(
            404,
            "NOT_FOUND",
            "That invoice could not be found.",
          );
        }

        const updated = await withBillingConflict(() =>
          options.invoiceStore.applyAction(
            organization,
            invoice.id,
            route.action,
            actor(res),
          ),
        );
        const response: InvoiceResponse = { invoice: toInvoice(updated) };

        res.status(200).json(response);
      },
    );
  }

  router.post(
    "/api/invoices/:invoiceId/payments",
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    async (req, res) => {
      const organization = organizationId(res);
      const params = parseParams(invoiceIdParamsSchema, req.params);
      const payload = parseBody(recordPaymentSchema, req.body);
      const invoice = await options.invoiceStore.findById(
        organization,
        params.invoiceId,
      );

      if (!invoice) {
        throw new AppError(404, "NOT_FOUND", "That invoice could not be found.");
      }

      const result = await withBillingConflict(() =>
        options.invoiceStore.recordPayment({
          organizationId: organization,
          invoiceId: invoice.id,
          amountMinor: payload.amountMinor,
          method: payload.method,
          reference: payload.reference ?? null,
          note: payload.note ?? null,
          status: payload.status,
          actor: actor(res),
        }),
      );
      const response: PaymentActionResponse = {
        payment: toPayment(result.payment),
        invoice: toInvoice(result.invoice),
      };

      res
        .location(API_PATHS.invoice(result.invoice.id))
        .status(201)
        .json(response);
    },
  );

  const paymentActions = ["succeed", "fail", "refund"] as const;

  for (const action of paymentActions) {
    router.post(
      `/api/payments/:paymentId/${action}`,
      options.authenticate,
      options.requireOrganization,
      options.requireAdmin,
      async (req, res) => {
        const organization = organizationId(res);
        const params = parseParams(paymentIdParamsSchema, req.params);
        const payment = await options.invoiceStore.findPaymentById(
          organization,
          params.paymentId,
        );

        if (!payment) {
          throw new AppError(
            404,
            "NOT_FOUND",
            "That payment could not be found.",
          );
        }

        const result = await withBillingConflict(() =>
          options.invoiceStore.transitionPayment({
            organizationId: organization,
            paymentId: payment.id,
            action,
            actor: actor(res),
          }),
        );
        const response: PaymentActionResponse = {
          payment: toPayment(result.payment),
          invoice: toInvoice(result.invoice),
        };

        res
          .location(API_PATHS.invoice(result.invoice.id))
          .status(200)
          .json(response);
      },
    );
  }

  return router;
}
