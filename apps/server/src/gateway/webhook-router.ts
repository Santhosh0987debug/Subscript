import express, { Router, type RequestHandler } from "express";
import { API_PATHS, type GatewayWebhookResponse } from "@subscript/shared";
import { GatewayPayloadError } from "./errors.js";
import { withGatewayErrors } from "./http.js";
import type { GatewayService } from "./service.js";

export interface RazorpayWebhookRouterOptions {
  gatewayService: GatewayService;
  rateLimiter: RequestHandler;
}

export function createRazorpayWebhookRouter(
  options: RazorpayWebhookRouterOptions,
): Router {
  const router = Router();
  const rawJson = express.raw({ type: "application/json", limit: "256kb" });

  router.post(
    API_PATHS.razorpayWebhook,
    options.rateLimiter,
    rawJson,
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new GatewayPayloadError(
          "The webhook body must be raw JSON bytes.",
        );
      }

      const result = await withGatewayErrors(() =>
        options.gatewayService.processWebhook({
          rawBody: req.body as Buffer,
          signature: req.get("x-razorpay-signature") ?? null,
          eventId: req.get("x-razorpay-event-id") ?? null,
        }),
      );
      const payload: GatewayWebhookResponse = result;

      res.status(200).json(payload);
    },
  );

  return router;
}
