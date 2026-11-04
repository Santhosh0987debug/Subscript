import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CORS keeps browsers from reading responses, but it does not stop a
 * cross-site form from issuing a state-changing request. Rejecting untrusted
 * Origin headers closes that gap for cookie-authenticated writes.
 */
export function createOriginGuard(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);

  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const origin = req.get("origin");

    if (origin && !allowed.has(origin)) {
      next(new AppError(403, "FORBIDDEN", "Request origin is not allowed."));
      return;
    }

    next();
  };
}
