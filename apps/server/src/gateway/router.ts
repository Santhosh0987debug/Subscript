import { Router, type RequestHandler, type Response } from "express";
import {
  API_PATHS,
  type GatewayCheckoutSession,
  type GatewayConfigResponse,
  type GatewayRefundResponse,
  type PaymentActionResponse,
} from "@subscript/shared";
import type { AuthenticatedSession } from "../auth/types.js";
import { AppError } from "../errors/app-error.js";
import { parseBody, parseParams } from "../lib/validation.js";
import {
  toInvoice,
  toPayment,
  toPaymentRefund,
} from "../invoices/serializer.js";
import type { InvoiceStore } from "../invoices/types.js";
import {
  invoiceIdParamsSchema,
  paymentIdParamsSchema,
} from "../invoices/validation.js";
import { withGatewayErrors } from "./http.js";
import type { GatewayService } from "./service.js";
import {
  cancelGatewayCheckoutSchema,
  gatewayRefundSchema,
  verifyGatewayPaymentSchema,
} from "./validation.js";

export interface GatewayRouterOptions {
  gatewayService: GatewayService;
  invoiceStore: InvoiceStore;
  authenticate: RequestHandler;
  requireOrganization: RequestHandler;
  requireAdmin: RequestHandler;
  rateLimiter: RequestHandler;
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

function actor(res: Response) {
  const authenticated = res.locals.auth as AuthenticatedSession | undefined;

  return {
    actorId: authenticated?.session.user.id ?? null,
    actorName: authenticated?.session.user.name ?? null,
  };
}

export function createGatewayRouter(
  options: GatewayRouterOptions,
): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get(
    API_PATHS.gatewayConfig,
    options.authenticate,
    options.requireOrganization,
    options.rateLimiter,
    (_req, res) => {
      const payload: GatewayConfigResponse = options.gatewayService.config();

      res.status(200).json(payload);
    },
  );

  router.post(
    "/api/invoices/:invoiceId/checkout",
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    options.rateLimiter,
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

      const session = await withGatewayErrors(() =>
        options.gatewayService.createCheckout({
          organizationId: organization,
          invoiceId: invoice.id,
          actor: actor(res),
        }),
      );
      const payload: GatewayCheckoutSession = {
        ...session,
        payment: toPayment(session.payment),
      };

      res
        .location(API_PATHS.invoice(invoice.id))
        .status(201)
        .json(payload);
    },
  );

  router.post(
    "/api/payments/:paymentId/gateway/verify",
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    options.rateLimiter,
    async (req, res) => {
      const organization = organizationId(res);
      const params = parseParams(paymentIdParamsSchema, req.params);
      const body = parseBody(verifyGatewayPaymentSchema, req.body);
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

      const result = await withGatewayErrors(() =>
        options.gatewayService.verifyPayment({
          organizationId: organization,
          paymentId: payment.id,
          orderId: body.orderId,
          gatewayPaymentId: body.gatewayPaymentId,
          signature: body.signature,
          actor: actor(res),
        }),
      );
      const payload: PaymentActionResponse = {
        payment: toPayment(result.payment),
        invoice: toInvoice(result.invoice),
      };

      res.status(200).json(payload);
    },
  );

  router.post(
    "/api/payments/:paymentId/gateway/cancel",
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    options.rateLimiter,
    async (req, res) => {
      const organization = organizationId(res);
      const params = parseParams(paymentIdParamsSchema, req.params);
      const body = parseBody(cancelGatewayCheckoutSchema, req.body);
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

      const cancelled = await withGatewayErrors(() =>
        options.gatewayService.cancelCheckout({
          organizationId: organization,
          paymentId: payment.id,
          orderId: body.orderId ?? null,
          actor: actor(res),
        }),
      );
      const invoice = await options.invoiceStore.findById(
        organization,
        cancelled.invoiceId,
      );

      if (!invoice) {
        throw new AppError(
          404,
          "NOT_FOUND",
          "The invoice for this payment could not be found.",
        );
      }

      const payload: PaymentActionResponse = {
        payment: toPayment(cancelled),
        invoice: toInvoice(invoice),
      };

      res.status(200).json(payload);
    },
  );

  router.post(
    "/api/payments/:paymentId/gateway/refund",
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    options.rateLimiter,
    async (req, res) => {
      const organization = organizationId(res);
      const params = parseParams(paymentIdParamsSchema, req.params);
      const body = parseBody(gatewayRefundSchema, req.body);
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

      const result = await withGatewayErrors(() =>
        options.gatewayService.refund({
          organizationId: organization,
          paymentId: payment.id,
          ...(body.amountMinor === undefined
            ? {}
            : { amountMinor: body.amountMinor }),
          reason: body.reason ?? null,
          actor: actor(res),
        }),
      );
      const payload: GatewayRefundResponse = {
        payment: toPayment(result.payment),
        invoice: toInvoice(result.invoice),
        refund: toPaymentRefund(result.refund),
      };

      res.status(201).json(payload);
    },
  );

  return router;
}
