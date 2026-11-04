import request from "supertest";
import { describe, expect, it } from "vitest";
import { API_PATHS } from "@subscript/shared";
import type { ApiErrorResponse, HealthResponse } from "@subscript/shared";
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
