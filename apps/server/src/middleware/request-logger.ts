import type { RequestHandler } from "express";
import { logger } from "../lib/logger.js";
import { recordHttpRequest } from "../lib/metrics.js";

const OPERATIONAL_PATHS = new Set([
  "/api/health",
  "/api/ready",
  "/api/metrics",
]);

const UUID_SEGMENT =
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi;

function routeLabel(req: Parameters<RequestHandler>[0]): string {
  const routePath = req.route?.path;

  if (typeof routePath === "string") {
    return `${req.baseUrl}${routePath}` || "/";
  }

  return req.path.replace(UUID_SEGMENT, "/:id") || "/";
}

export interface RequestLoggerOptions {
  enabled: boolean;
}

/**
 * Structured completion logs and HTTP metrics. Query strings and bodies are
 * deliberately excluded; user/customer identifiers are never logged.
 */
export function createRequestLogger(
  options: RequestLoggerOptions,
): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const path = req.path;
      const route = routeLabel(req);

      recordHttpRequest({
        method: req.method,
        route,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });

      if (!options.enabled || OPERATIONAL_PATHS.has(path)) {
        return;
      }

      const organization = res.locals.organization as
        | { id?: string }
        | undefined;
      const auth = res.locals.auth as
        | { session?: { user?: { id?: string } } }
        | undefined;

      logger.info("HTTP request", {
        requestId: res.locals.requestId,
        correlationId: res.locals.correlationId,
        method: req.method,
        path,
        route,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        userId: auth?.session?.user?.id ?? null,
        organizationId: organization?.id ?? null,
      });
    });

    next();
  };
}
