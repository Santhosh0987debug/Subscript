import request from "supertest";
import { describe, expect, it } from "vitest";
import { API_PATHS } from "@subscript/shared";
import type { ApiErrorResponse } from "@subscript/shared";
import { registerAccount, TEST_PASSWORD } from "./helpers/accounts.js";
import { createTestApp, TEST_ORIGIN } from "./helpers/test-app.js";

describe("auth rate limiting", () => {
  it("returns a consistent 429 envelope after repeated failures", async () => {
    const { app } = createTestApp({
      authRateLimit: { windowMs: 60_000, limit: 2 },
    });
    await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });

    const attempt = () =>
      request(app)
        .post(API_PATHS.authLogin)
        .set("Origin", TEST_ORIGIN)
        .send({ email: "alex@example.com", password: "WrongPassword9" });

    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);

    const limited = await attempt();
    expect(limited.status).toBe(429);
    const body = limited.body as ApiErrorResponse;
    expect(body.error.code).toBe("TOO_MANY_REQUESTS");
    expect(body.error.requestId).toBe(limited.headers["x-request-id"]);
  });

  it("does not count successful logins against the limit", async () => {
    const { app } = createTestApp({
      authRateLimit: { windowMs: 60_000, limit: 1 },
    });
    await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request(app)
        .post(API_PATHS.authLogin)
        .set("Origin", TEST_ORIGIN)
        .send({ email: "alex@example.com", password: TEST_PASSWORD });

      expect(response.status).toBe(200);
    }
  });
});

describe("credentialed CORS", () => {
  it("allows the configured origin to send cookies", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .get(API_PATHS.health)
      .set("Origin", TEST_ORIGIN);

    expect(response.headers["access-control-allow-origin"]).toBe(TEST_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
});
