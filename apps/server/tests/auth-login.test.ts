import request from "supertest";
import { describe, expect, it } from "vitest";
import { API_PATHS } from "@subscript/shared";
import type { ApiErrorResponse, SessionResponse } from "@subscript/shared";
import { registerAccount, readSetCookie, TEST_PASSWORD } from "./helpers/accounts.js";
import { createTestApp, TEST_ORIGIN } from "./helpers/test-app.js";

describe("POST /api/auth/login", () => {
  it("authenticates a user and issues a fresh session", async () => {
    const { app } = createTestApp();
    await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });

    const agent = request.agent(app);
    const response = await agent
      .post(API_PATHS.authLogin)
      .set("Origin", TEST_ORIGIN)
      .send({ email: "ALEX@example.com", password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    const body = response.body as SessionResponse;
    expect(body.user.email).toBe("alex@example.com");
    expect(body.activeOrganizationId).toBe(body.organizations[0]?.id);
    expect(readSetCookie(response)).toContain("HttpOnly");

    const me = await agent.get(API_PATHS.authMe).set("Origin", TEST_ORIGIN);
    expect(me.status).toBe(200);
  });

  it("uses the same generic error for a wrong password and an unknown email", async () => {
    const { app } = createTestApp();
    await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });

    const wrongPassword = await request(app)
      .post(API_PATHS.authLogin)
      .set("Origin", TEST_ORIGIN)
      .send({ email: "alex@example.com", password: "WrongPassword9" });
    const unknownEmail = await request(app)
      .post(API_PATHS.authLogin)
      .set("Origin", TEST_ORIGIN)
      .send({ email: "nobody@example.com", password: "WrongPassword9" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);

    const wrongBody = wrongPassword.body as ApiErrorResponse;
    const unknownBody = unknownEmail.body as ApiErrorResponse;
    expect(wrongBody.error.code).toBe("UNAUTHORIZED");
    expect(wrongBody.error.message).toBe("Invalid email or password.");
    expect(unknownBody.error.message).toBe("Invalid email or password.");
  });

  it("rejects invalid login payloads before checking credentials", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post(API_PATHS.authLogin)
      .set("Origin", TEST_ORIGIN)
      .send({ email: "not-an-email", password: "" });

    expect(response.status).toBe(400);
    const body = response.body as ApiErrorResponse;
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details?.length).toBeGreaterThan(0);
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes the session and clears the cookie", async () => {
    const { app } = createTestApp();
    const { agent } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });

    const response = await agent
      .post(API_PATHS.authLogout)
      .set("Origin", TEST_ORIGIN);

    expect(response.status).toBe(204);
    expect(readSetCookie(response)).toContain("subscript_session=;");

    const me = await agent.get(API_PATHS.authMe).set("Origin", TEST_ORIGIN);
    expect(me.status).toBe(401);
  });

  it("is idempotent without an active session", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post(API_PATHS.authLogout)
      .set("Origin", TEST_ORIGIN);

    expect(response.status).toBe(204);
  });
});

describe("session expiry", () => {
  it("rejects a session after its expiry date", async () => {
    const { app } = createTestApp({ sessionTtlMs: 1 });
    const { agent } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    const response = await agent.get(API_PATHS.authMe).set("Origin", TEST_ORIGIN);

    expect(response.status).toBe(401);
  });
});
