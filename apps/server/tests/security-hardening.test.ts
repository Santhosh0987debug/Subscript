import request from "supertest";
import { describe, expect, it } from "vitest";
import { API_PATHS } from "@subscript/shared";
import type { ApiErrorResponse } from "@subscript/shared";
import { redactLogText, safeErrorContext } from "../src/lib/logger.js";
import { readSetCookie } from "./helpers/accounts.js";
import { createTestApp, TEST_ORIGIN } from "./helpers/test-app.js";

describe("request tracing", () => {
  it("accepts a valid caller request id and correlation id", async () => {
    const { app } = createTestApp();
    const requestId = "11111111-1111-4111-8111-111111111111";
    const response = await request(app)
      .get(API_PATHS.health)
      .set("X-Request-Id", requestId)
      .set("X-Correlation-Id", "checkout-flow:42");

    expect(response.headers["x-request-id"]).toBe(requestId);
    expect(response.headers["x-correlation-id"]).toBe("checkout-flow:42");
  });

  it("replaces an unsafe request id instead of reflecting it", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .get(API_PATHS.health)
      .set("X-Request-Id", "<script>alert(1)</script>");

    expect(response.headers["x-request-id"]).not.toContain("script");
    expect(response.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe("origin guard", () => {
  it("rejects state-changing requests with a null origin", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post(API_PATHS.authLogout)
      .set("Origin", "null");

    expect(response.status).toBe(403);
    expect((response.body as ApiErrorResponse).error.code).toBe("FORBIDDEN");
  });

  it("rejects browser requests marked as cross-site", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post(API_PATHS.authLogout)
      .set("Sec-Fetch-Site", "cross-site");

    expect(response.status).toBe(403);
  });

  it("allows same-origin state-changing requests", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post(API_PATHS.authLogout)
      .set("Origin", TEST_ORIGIN)
      .set("Sec-Fetch-Site", "same-origin");

    expect(response.status).toBe(204);
  });
});

describe("API abuse protection", () => {
  it("applies a global API rate limit", async () => {
    const { app } = createTestApp({
      apiRateLimit: { windowMs: 60_000, limit: 2 },
    });

    const first = await request(app).get("/api/unknown-route");
    const second = await request(app).get("/api/unknown-route");
    const third = await request(app).get("/api/unknown-route");

    expect(first.status).toBe(404);
    expect(second.status).toBe(404);
    expect(third.status).toBe(429);
    expect((third.body as ApiErrorResponse).error.code).toBe(
      "TOO_MANY_REQUESTS",
    );
  });

  it("keeps health checks outside the API limiter", async () => {
    const { app } = createTestApp({
      apiRateLimit: { windowMs: 60_000, limit: 1 },
    });

    await request(app).get("/api/unknown-route");
    await request(app).get("/api/unknown-route");

    const health = await request(app).get(API_PATHS.health);
    expect(health.status).toBe(200);
  });
});

describe("session cookie hardening", () => {
  it("supports a __Host- prefixed production cookie", async () => {
    const { app } = createTestApp({
      cookieName: "__Host-subscript_session",
      cookieSecure: true,
    });
    const response = await request(app)
      .post(API_PATHS.authRegister)
      .set("Origin", TEST_ORIGIN)
      .send({
        name: "Alex Morgan",
        email: "alex@example.com",
        password: "CorrectHorse9",
        organizationName: "Northwind Labs",
      });

    const cookie = readSetCookie(response);
    expect(cookie).toContain("__Host-subscript_session=");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Priority=High");
  });

  it("ignores malformed session tokens without crashing", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .get(API_PATHS.authMe)
      .set("Cookie", `subscript_session=${"a".repeat(600)}`);

    expect(response.status).toBe(401);
  });
});

describe("JSON response safety", () => {
  it("escapes HTML-sensitive characters", () => {
    const { app } = createTestApp();
    expect(app.get("json escape")).toBe(true);
  });
});

describe("log redaction", () => {
  it("removes emails, bearer tokens, and long tokens from text", () => {
    const redacted = redactLogText(
      "contact alex@example.com with Bearer abc.def.ghi and token " +
        "A".repeat(64),
    );

    expect(redacted).not.toContain("alex@example.com");
    expect(redacted).not.toContain("abc.def.ghi");
    expect(redacted).not.toContain("A".repeat(64));
  });

  it("redacts sensitive keys on error context", () => {
    const context = safeErrorContext(new Error("login failed for alex@example.com"));

    expect(JSON.stringify(context)).not.toContain("alex@example.com");
    expect(String(context.message)).toContain("[redacted-email]");
  });
});
