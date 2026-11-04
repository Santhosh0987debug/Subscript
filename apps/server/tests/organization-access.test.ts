import request from "supertest";
import { describe, expect, it } from "vitest";
import { API_PATHS } from "@subscript/shared";
import type {
  ApiErrorResponse,
  CurrentOrganizationResponse,
  SessionResponse,
} from "@subscript/shared";
import { registerAccount } from "./helpers/accounts.js";
import { createTestApp, TEST_ORIGIN } from "./helpers/test-app.js";

async function switchOrganization(
  agent: ReturnType<typeof request.agent>,
  organizationId: string,
) {
  return agent
    .post(API_PATHS.switchOrganization(organizationId))
    .set("Origin", TEST_ORIGIN);
}

describe("organization-scoped access", () => {
  it("requires authentication", async () => {
    const { app } = createTestApp();
    const response = await request(app).get(API_PATHS.currentOrganization);

    expect(response.status).toBe(401);
    const body = response.body as ApiErrorResponse;
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns the active organization and its members", async () => {
    const { app } = createTestApp();
    const { agent, account } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });
    const response = await agent.get(API_PATHS.currentOrganization);

    expect(response.status).toBe(200);
    const body = response.body as CurrentOrganizationResponse;
    expect(body.organization.id).toBe(account.organizationId);
    expect(body.organization.name).toBe("Northwind Labs");
    expect(body.role).toBe("OWNER");
    expect(body.members).toHaveLength(1);
    expect(body.members[0]?.userId).toBe(account.id);
    expect(body.members[0]?.role).toBe("OWNER");
  });

  it("does not allow a user to switch into another tenant", async () => {
    const { app } = createTestApp();
    const alice = await registerAccount(app, {
      name: "Alice Stone",
      email: "alice@example.com",
      organizationName: "Alice Workspace",
    });
    const bob = await registerAccount(app, {
      name: "Bob Reed",
      email: "bob@example.com",
      organizationName: "Bob Workspace",
    });

    const response = await switchOrganization(
      bob.agent,
      alice.account.organizationId,
    );

    expect(response.status).toBe(403);
    const body = response.body as ApiErrorResponse;
    expect(body.error.code).toBe("FORBIDDEN");

    const me = await bob.agent.get(API_PATHS.authMe);
    const session = me.body as SessionResponse;
    expect(session.activeOrganizationId).toBe(bob.account.organizationId);
  });

  it("switches between organizations the user belongs to", async () => {
    const { app, store } = createTestApp();
    const alice = await registerAccount(app, {
      name: "Alice Stone",
      email: "alice@example.com",
      organizationName: "Alice Workspace",
    });
    const bob = await registerAccount(app, {
      name: "Bob Reed",
      email: "bob@example.com",
      organizationName: "Bob Workspace",
    });

    store.addMember(alice.account.organizationId, bob.account.id, "MEMBER");

    const switched = await switchOrganization(
      bob.agent,
      alice.account.organizationId,
    );

    expect(switched.status).toBe(200);
    const session = switched.body as SessionResponse;
    expect(session.activeOrganizationId).toBe(alice.account.organizationId);
    expect(session.organizations.map((org) => org.id)).toEqual(
      expect.arrayContaining([alice.account.organizationId, bob.account.organizationId]),
    );

    const current = await bob.agent.get(API_PATHS.currentOrganization);
    const body = current.body as CurrentOrganizationResponse;
    expect(body.organization.id).toBe(alice.account.organizationId);
    expect(body.role).toBe("MEMBER");
    expect(body.members.map((member) => member.email).sort()).toEqual([
      "alice@example.com",
      "bob@example.com",
    ]);
  });

  it("prevents a member from updating the organization", async () => {
    const { app, store } = createTestApp();
    const alice = await registerAccount(app, {
      name: "Alice Stone",
      email: "alice@example.com",
      organizationName: "Alice Workspace",
    });
    const bob = await registerAccount(app, {
      name: "Bob Reed",
      email: "bob@example.com",
      organizationName: "Bob Workspace",
    });

    store.addMember(alice.account.organizationId, bob.account.id, "MEMBER");
    await switchOrganization(bob.agent, alice.account.organizationId);

    const response = await bob.agent
      .patch(API_PATHS.currentOrganization)
      .set("Origin", TEST_ORIGIN)
      .send({ name: "Hijacked Workspace" });

    expect(response.status).toBe(403);
    const body = response.body as ApiErrorResponse;
    expect(body.error.code).toBe("FORBIDDEN");

    const aliceCurrent = await alice.agent.get(API_PATHS.currentOrganization);
    expect(
      (aliceCurrent.body as CurrentOrganizationResponse).organization.name,
    ).toBe("Alice Workspace");
  });

  it("allows owners and admins to update the organization", async () => {
    const { app, store } = createTestApp();
    const alice = await registerAccount(app, {
      name: "Alice Stone",
      email: "alice@example.com",
      organizationName: "Alice Workspace",
    });
    const bob = await registerAccount(app, {
      name: "Bob Reed",
      email: "bob@example.com",
      organizationName: "Bob Workspace",
    });

    store.addMember(alice.account.organizationId, bob.account.id, "ADMIN");
    await switchOrganization(bob.agent, alice.account.organizationId);

    const adminUpdate = await bob.agent
      .patch(API_PATHS.currentOrganization)
      .set("Origin", TEST_ORIGIN)
      .send({ name: "Alice Studio" });
    const ownerUpdate = await alice.agent
      .patch(API_PATHS.currentOrganization)
      .set("Origin", TEST_ORIGIN)
      .send({ name: "Alice Labs" });

    expect(adminUpdate.status).toBe(200);
    expect(ownerUpdate.status).toBe(200);
    expect(
      (ownerUpdate.body as { organization: { name: string } }).organization.name,
    ).toBe("Alice Labs");
  });

  it("keeps organization data isolated across switches", async () => {
    const { app, store } = createTestApp();
    const alice = await registerAccount(app, {
      name: "Alice Stone",
      email: "alice@example.com",
      organizationName: "Alice Workspace",
    });
    const bob = await registerAccount(app, {
      name: "Bob Reed",
      email: "bob@example.com",
      organizationName: "Bob Workspace",
    });

    store.addMember(alice.account.organizationId, bob.account.id, "MEMBER");

    const bobOwn = await bob.agent.get(API_PATHS.currentOrganization);
    const bobOwnBody = bobOwn.body as CurrentOrganizationResponse;
    expect(bobOwnBody.organization.id).toBe(bob.account.organizationId);
    expect(bobOwnBody.members).toHaveLength(1);
    expect(bobOwnBody.members[0]?.email).toBe("bob@example.com");

    await switchOrganization(bob.agent, alice.account.organizationId);
    const aliceOrg = await bob.agent.get(API_PATHS.currentOrganization);
    const aliceOrgBody = aliceOrg.body as CurrentOrganizationResponse;
    expect(aliceOrgBody.organization.id).toBe(alice.account.organizationId);
    expect(
      aliceOrgBody.members.some((member) => member.email === "bob@example.com"),
    ).toBe(true);

    await switchOrganization(bob.agent, bob.account.organizationId);
    const backHome = await bob.agent.get(API_PATHS.currentOrganization);
    expect((backHome.body as CurrentOrganizationResponse).organization.id).toBe(
      bob.account.organizationId,
    );
  });

  it("rejects a malformed organization id when switching", async () => {
    const { app } = createTestApp();
    const { agent } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });
    const response = await agent
      .post("/api/organizations/not-a-uuid/switch")
      .set("Origin", TEST_ORIGIN);

    expect(response.status).toBe(400);
    const body = response.body as ApiErrorResponse;
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
