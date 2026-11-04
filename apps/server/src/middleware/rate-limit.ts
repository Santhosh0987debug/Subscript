import { rateLimit } from "express-rate-limit";
import type { RequestHandler } from "express";
import type { ApiErrorResponse } from "@subscript/shared";

export interface RateLimitOptions {
  windowMs: number;
  limit: number;
}

export const DEFAULT_AUTH_RATE_LIMIT: RateLimitOptions = {
  windowMs: 15 * 60 * 1000,
  limit: 20,
};

export function createAuthRateLimiter(options: RateLimitOptions): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, res) => {
      const payload: ApiErrorResponse = {
        error: {
          code: "TOO_MANY_REQUESTS",
          message: "Too many authentication attempts. Try again shortly.",
          requestId: String(res.locals.requestId ?? "unknown"),
        },
      };

      res.status(429).json(payload);
    },
  });
}
