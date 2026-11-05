import { rateLimit } from "express-rate-limit";
import type { RequestHandler } from "express";
import type { ApiErrorCode, ApiErrorResponse } from "@subscript/shared";

export interface RateLimitOptions {
  windowMs: number;
  limit: number;
}

export const DEFAULT_AUTH_RATE_LIMIT: RateLimitOptions = {
  windowMs: 15 * 60 * 1000,
  limit: 20,
};

export const DEFAULT_GATEWAY_RATE_LIMIT: RateLimitOptions = {
  windowMs: 60 * 1000,
  limit: 30,
};

export const DEFAULT_WEBHOOK_RATE_LIMIT: RateLimitOptions = {
  windowMs: 60 * 1000,
  limit: 120,
};

export function createRequestRateLimiter(
  options: RateLimitOptions,
  message: string,
  skipSuccessfulRequests = false,
): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests,
    handler: (_req, res) => {
      const payload: ApiErrorResponse = {
        error: {
          code: "TOO_MANY_REQUESTS" as ApiErrorCode,
          message,
          requestId: String(res.locals.requestId ?? "unknown"),
        },
      };

      res.status(429).json(payload);
    },
  });
}

export function createAuthRateLimiter(options: RateLimitOptions): RequestHandler {
  return createRequestRateLimiter(
    options,
    "Too many authentication attempts. Try again shortly.",
    true,
  );
}
