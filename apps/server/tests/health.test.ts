import request from "supertest";
import { describe, expect, it } from "vitest";
import { API_PATHS } from "@subscript/shared";
import type {
  ApiErrorResponse,
  HealthResponse,
  ReadyResponse,
} from "@subscript/shared";
import { createTestApp, TEST_ORIGIN } from "./helpers/test-app.js";

const allowedOrigin = TEST_ORIGIN;
const { app } = createTestApp();

describe("GET /api/health", () => {
  it("returns a live health payload with a request id", async () => {
    const response = await request(app)
      .get(API_PATHS.health)
      .set("Origin", allowedOrigin);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(response.headers["access-control-allow-origin"]).toBe(allowedOrigin);
    expect(response.headers["x-powered-by"]).toBeUndefined();

    const body = response.body as HealthResponse;
    expect(body.status).toBe("ok");
    expect(body.service).toBe("subscript-api");
    expect(body.version).toBe("0.1.0");
    expect(Number.isInteger(body.uptimeSeconds)).toBe(true);
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(new Date(body.timestamp).toString()).not.toBe("Invalid Date");
  });

  it("does not grant cross-origin access to unknown origins", async () => {
    const response = await request(app)
      .get(API_PATHS.health)
      .set("Origin", "https://untrusted.example.com");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("error handling", () => {
  it("returns the shared error envelope for unknown routes", async () => {
    const response = await request(app).get("/api/unknown-route");

    expect(response.status).toBe(404);
    expect(response.headers["x-request-id"]).toBeDefined();

    const body = response.body as ApiErrorResponse;
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("No route matches");
    expect(body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  it("maps malformed JSON to an explicit bad request error", async () => {
    const response = await request(app)
      .post(API_PATHS.health)
      .set("Content-Type", "application/json")
      .send("{invalid");

    expect(response.status).toBe(400);

    const body = response.body as ApiErrorResponse;
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toBe("The request body is not valid JSON.");
    expect(body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  it("does not leak internal error details", async () => {
    const response = await request(app)
      .post(API_PATHS.health)
      .set("Content-Type", "application/json")
      .send("{invalid");

    const body = response.body as ApiErrorResponse;
    expect(JSON.stringify(body)).not.toContain("stack");
    expect(body.error.message).not.toContain("SyntaxError");
  });
});

describe("GET /api/ready", () => {
  it("reports healthy required and optional dependencies", async () => {
    const { app: readyApp } = createTestApp({
      readiness: {
        database: async () => undefined,
        redis: async () => undefined,
      },
    });
    const response = await request(readyApp).get(API_PATHS.ready);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");

    const body = response.body as ReadyResponse;
    expect(body.status).toBe("ok");
    expect(body.checks.map((check) => check.name)).toEqual([
      "database",
      "redis",
    ]);
    expect(body.checks.every((check) => check.status === "ok")).toBe(true);
  });

  it("fails readiness when the database is unavailable", async () => {
    const { app: readyApp } = createTestApp({
      readiness: {
        database: async () => {
          throw new Error("connection refused");
        },
      },
    });
    const response = await request(readyApp).get(API_PATHS.ready);

    expect(response.status).toBe(503);
    const body = response.body as ReadyResponse;
    expect(body.status).toBe("error");
    expect(body.checks[0]?.status).toBe("error");
    expect(body.checks[1]?.status).toBe("skipped");
    expect(JSON.stringify(body)).not.toContain("connection refused");
  });

  it("stays ready but degrades when Redis is unavailable", async () => {
    const { app: readyApp } = createTestApp({
      readiness: {
        database: async () => undefined,
        redis: async () => {
          throw new Error("redis down");
        },
      },
    });
    const response = await request(readyApp).get(API_PATHS.ready);

    expect(response.status).toBe(200);
    const body = response.body as ReadyResponse;
    expect(body.status).toBe("degraded");
    expect(body.checks[1]?.status).toBe("degraded");
  });
});

describe("GET /api/metrics", () => {
  const token = "test-metrics-token-1234567890";

  it("is hidden when no metrics token is configured", async () => {
    const { app: metricsApp } = createTestApp();
    const response = await request(metricsApp).get(API_PATHS.metrics);

    expect(response.status).toBe(404);
  });

  it("requires the configured bearer token", async () => {
    const { app: metricsApp } = createTestApp({ metricsToken: token });

    const missing = await request(metricsApp).get(API_PATHS.metrics);
    expect(missing.status).toBe(401);

    const wrong = await request(metricsApp)
      .get(API_PATHS.metrics)
      .set("Authorization", "Bearer wrong-token");
    expect(wrong.status).toBe(401);
  });

  it("renders Prometheus metrics for an authorized caller", async () => {
    const { app: metricsApp } = createTestApp({ metricsToken: token });
    await request(metricsApp).get(API_PATHS.health).set("Origin", TEST_ORIGIN);

    const response = await request(metricsApp)
      .get(API_PATHS.metrics)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.text).toContain("subscript_http_requests_total");
    expect(response.text).toContain("subscript_process_uptime_seconds");
    expect(response.text).not.toContain(token);
  });
});
