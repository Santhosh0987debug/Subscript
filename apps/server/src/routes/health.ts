import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import type {
  HealthResponse,
  ReadinessCheck,
  ReadinessStatus,
  ReadyResponse,
} from "@subscript/shared";
import { AppError } from "../errors/app-error.js";
import { renderMetrics, setGauge } from "../lib/metrics.js";

const SERVICE_VERSION = "0.1.0";
const DEFAULT_READINESS_TIMEOUT_MS = 3_000;

export interface ReadinessOptions {
  database?: (() => Promise<unknown>) | undefined;
  redis?: (() => Promise<unknown>) | undefined;
  timeoutMs?: number;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  return Promise.race([
    operation,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("Readiness check timed out.")),
        timeoutMs,
      );
      timer.unref();
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

async function runCheck(
  name: string,
  required: boolean,
  operation: (() => Promise<unknown>) | undefined,
  timeoutMs: number,
): Promise<ReadinessCheck> {
  if (!operation) {
    return {
      name,
      status: "skipped",
      latencyMs: null,
      message: "Not configured.",
    };
  }

  const startedAt = process.hrtime.bigint();

  try {
    await withTimeout(operation(), timeoutMs);
    const latencyMs =
      Math.round((Number(process.hrtime.bigint() - startedAt) / 1_000_000) * 100) /
      100;
    setGauge("subscript_dependency_up", 1, { dependency: name });

    return { name, status: "ok", latencyMs };
  } catch {
    const latencyMs =
      Math.round((Number(process.hrtime.bigint() - startedAt) / 1_000_000) * 100) /
      100;
    setGauge("subscript_dependency_up", 0, { dependency: name });

    return {
      name,
      status: required ? "error" : "degraded",
      latencyMs,
      message: required
        ? "The dependency is unavailable."
        : "The optional dependency is unavailable.",
    };
  }
}

export const healthHandler: RequestHandler = (_req, res) => {
  const payload: HealthResponse = {
    status: "ok",
    service: "subscript-api",
    version: SERVICE_VERSION,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  };

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(payload);
};

export function createReadinessHandler(
  options: ReadinessOptions = {},
): RequestHandler {
  const timeoutMs = options.timeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;

  return async (_req, res, next) => {
    try {
      const checks = await Promise.all([
        runCheck("database", true, options.database, timeoutMs),
        runCheck("redis", false, options.redis, timeoutMs),
      ]);
      const status: ReadinessStatus = checks.some(
        (check) => check.status === "error",
      )
        ? "error"
        : checks.some((check) => check.status === "degraded")
          ? "degraded"
          : "ok";
      const payload: ReadyResponse = {
        status,
        service: "subscript-api",
        version: SERVICE_VERSION,
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        checks,
      };

      res.setHeader("Cache-Control", "no-store");
      res.status(status === "error" ? 503 : 200).json(payload);
    } catch (error) {
      next(error);
    }
  };
}

function tokenMatches(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");

  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

export function createMetricsHandler(token: string | null): RequestHandler {
  return (req, res, next) => {
    if (!token) {
      next(new AppError(404, "NOT_FOUND", "No route matches this request."));
      return;
    }

    const authorization = req.get("authorization") ?? "";
    const prefix = "Bearer ";

    if (
      !authorization.startsWith(prefix) ||
      !tokenMatches(token, authorization.slice(prefix.length))
    ) {
      next(new AppError(401, "UNAUTHORIZED", "Metrics credentials are invalid."));
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.type("text/plain; version=0.0.4; charset=utf-8");
    res.status(200).send(renderMetrics());
  };
}
