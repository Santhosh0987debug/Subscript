import request from "supertest";
import { describe, expect, it } from "vitest";
import { API_PATHS } from "@subscript/shared";
import type { ApiErrorResponse, SessionResponse } from "@subscript/shared";
import { registerAccount, readSetCookie, TEST_PASSWORD } from "./helpers/accounts.js";
import { createTestApp, TEST_ORIGIN } from "./helpers/test-app.js";

describe("POST /api/auth/register", () => {
  it("creates a user and their first organization in one flow", async () => {
    const { app, store } = createTestApp();
    const response = await request(app)
      .post(API_PATHS.authRegister)
      .set("Origin", TEST_ORIGIN)
      .send({
        name: "Alex Morgan",
        email: "Alex@Example.com",
        password: TEST_PASSWORD,
        organizationName: "Northwind Labs",
      });

    expect(response.status).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");

    const body = response.body as SessionResponse;
    expect(body.user.name).toBe("Alex Morgan");
    expect(body.user.email).toBe("alex@example.com");
    expect(body.organizations).toHaveLength(1);
    expect(body.organizations[0]?.name).toBe("Northwind Labs");
    expect(body.organizations[0]?.role).toBe("OWNER");
    expect(body.activeOrganizationId).toBe(body.organizations[0]?.id);
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(JSON.stringify(body)).not.toContain("token");

    const storedUser = await store.findUserByEmail("alex@example.com");
    expect(storedUser?.passwordHash).not.toBe(TEST_PASSWORD);
    expect(storedUser?.passwordHash.startsWith("$2")).toBe(true);
  });

  it("sets a hardened HttpOnly session cookie", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post(API_PATHS.authRegister)
      .set("Origin", TEST_ORIGIN)
      .send({
        name: "Alex Morgan",
        email: "alex@example.com",
        password: TEST_PASSWORD,
        organizationName: "Northwind Labs",
      });

    const cookie = readSetCookie(response);
    expect(cookie).toContain("subscript_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");
  });

  it("marks the session cookie Secure when cookies are secure", async () => {
    const { app } = createTestApp({ cookieSecure: true });
    const response = await request(app)
      .post(API_PATHS.authRegister)
      .set("Origin", TEST_ORIGIN)
      .send({
        name: "Alex Morgan",
        email: "alex@example.com",
        password: TEST_PASSWORD,
        organizationName: "Northwind Labs",
      });

    expect(readSetCookie(response)).toContain("Secure");
  });

  it("rejects a duplicate email without creating another organization", async () => {
    const { app, store } = createTestApp();
    const { account } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });
    const response = await request(app)
      .post(API_PATHS.authRegister)
      .set("Origin", TEST_ORIGIN)
      .send({
        name: "Someone Else",
        email: "ALEX@example.com",
        password: TEST_PASSWORD,
        organizationName: "Another Workspace",
      });

    expect(response.status).toBe(409);
    const body = response.body as ApiErrorResponse;
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toContain("already exists");

    const originalUser = await store.findUserByEmail(account.email);
    expect(originalUser?.name).toBe("Alex Morgan");
  });

  it("returns field-level validation details", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post(API_PATHS.authRegister)
      .set("Origin", TEST_ORIGIN)
      .send({
        name: "A",
        email: "not-an-email",
        password: "short",
        organizationName: "",
      });

    expect(response.status).toBe(400);
    const body = response.body as ApiErrorResponse;
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details?.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(["name", "email", "password", "organizationName"]),
    );
  });

  it("rejects untrusted request origins", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post(API_PATHS.authRegister)
      .set("Origin", "https://attacker.example.com")
      .send({
        name: "Alex Morgan",
        email: "alex@example.com",
        password: TEST_PASSWORD,
        organizationName: "Northwind Labs",
      });

    expect(response.status).toBe(403);
    const body = response.body as ApiErrorResponse;
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("GET /api/auth/me", () => {
  it("returns the authenticated user, organizations, and active organization", async () => {
    const { app } = createTestApp();
    const { agent, account } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });
    const response = await agent.get(API_PATHS.authMe).set("Origin", TEST_ORIGIN);

    expect(response.status).toBe(200);
    const body = response.body as SessionResponse;
    expect(body.user.id).toBe(account.id);
    expect(body.activeOrganizationId).toBe(account.organizationId);
    expect(body.organizations[0]?.role).toBe("OWNER");
    expect(JSON.stringify(body)).not.toContain("passwordHash");
  });

  it("returns 401 without a session", async () => {
    const { app } = createTestApp();
    const response = await request(app).get(API_PATHS.authMe);

    expect(response.status).toBe(401);
    const body = response.body as ApiErrorResponse;
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});
