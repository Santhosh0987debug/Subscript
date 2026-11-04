import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  API_PATHS,
  type ApiErrorResponse,
  type CreatePlanRequest,
  type PlanListResponse,
  type PlanResponse,
} from "@subscript/shared";
import { registerAccount } from "./helpers/accounts.js";
import { createTestApp, TEST_ORIGIN } from "./helpers/test-app.js";

type Agent = ReturnType<typeof request.agent>;

function planPayload(overrides: Partial<CreatePlanRequest> = {}): CreatePlanRequest {
  return {
    name: "Pro",
    description: "For growing teams.",
    price: { amountMinor: 2900, currency: "USD" },
    interval: "MONTH",
    trialDays: 14,
    ...overrides,
  };
}

function createPlan(agent: Agent, overrides: Partial<CreatePlanRequest> = {}) {
  return agent
    .post(API_PATHS.plans)
    .set("Origin", TEST_ORIGIN)
    .send(planPayload(overrides));
}

async function switchTo(agent: Agent, organizationId: string) {
  return agent
    .post(API_PATHS.switchOrganization(organizationId))
    .set("Origin", TEST_ORIGIN);
}

describe("plan management", () => {
  it("requires authentication", async () => {
    const { app } = createTestApp();
    const response = await request(app).get(API_PATHS.plans);

    expect(response.status).toBe(401);
    expect((response.body as ApiErrorResponse).error.code).toBe("UNAUTHORIZED");
  });

  it("creates a plan with pricing, interval, and trial details", async () => {
    const { app } = createTestApp();
    const { agent, account } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });

    const created = await createPlan(agent);

    expect(created.status).toBe(201);
    const plan = (created.body as PlanResponse).plan;
    expect(created.headers.location).toBe(`/api/plans/${plan.id}`);
    expect(plan).toMatchObject({
      organizationId: account.organizationId,
      name: "Pro",
      code: "pro",
      description: "For growing teams.",
      price: { amountMinor: 2900, currency: "USD" },
      interval: "MONTH",
      trialDays: 14,
      status: "ACTIVE",
      subscriptionCount: 0,
    });

    const detail = await agent.get(API_PATHS.plan(plan.id));
    expect(detail.status).toBe(200);
    expect((detail.body as PlanResponse).plan.id).toBe(plan.id);

    const list = await agent.get(API_PATHS.plans);
    expect(list.status).toBe(200);
    expect((list.body as PlanListResponse).total).toBe(1);
  });

  it("supports multiple currencies and generates unique plan codes", async () => {
    const { app } = createTestApp();
    const { agent } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });

    const first = await createPlan(agent, {
      name: "Starter",
      price: { amountMinor: 4900, currency: "eur" },
      interval: "YEAR",
      trialDays: 0,
    });
    const second = await createPlan(agent, {
      name: "Starter",
      price: { amountMinor: 4900, currency: "EUR" },
      interval: "YEAR",
      trialDays: 0,
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstPlan = (first.body as PlanResponse).plan;
    const secondPlan = (second.body as PlanResponse).plan;
    expect(firstPlan.price.currency).toBe("EUR");
    expect(firstPlan.code).toBe("starter");
    expect(secondPlan.code).toBe("starter-2");

    const yen = await createPlan(agent, {
      name: "Tokyo",
      price: { amountMinor: 150000, currency: "JPY" },
      interval: "MONTH",
      trialDays: 7,
    });
    expect(yen.status).toBe(201);
    expect((yen.body as PlanResponse).plan.price.amountMinor).toBe(150000);
  });

  it("validates plan amounts, currencies, trials, and client organization ids", async () => {
    const { app } = createTestApp();
    const { agent } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });

    const negative = await createPlan(agent, {
      price: { amountMinor: -1, currency: "USD" },
    });
    expect(negative.status).toBe(400);

    const fractional = await createPlan(agent, {
      price: { amountMinor: 12.5, currency: "USD" },
    });
    expect(fractional.status).toBe(400);

    const badCurrency = await createPlan(agent, {
      price: { amountMinor: 1000, currency: "US" },
    });
    expect(badCurrency.status).toBe(400);

    const badTrial = await createPlan(agent, { trialDays: 366 });
    expect(badTrial.status).toBe(400);

    const clientOrganization = await agent
      .post(API_PATHS.plans)
      .set("Origin", TEST_ORIGIN)
      .send({
        ...planPayload(),
        organizationId: "00000000-0000-0000-0000-000000000000",
      });
    expect(clientOrganization.status).toBe(400);

    const badQuery = await agent.get(`${API_PATHS.plans}?interval=WEEK`);
    expect(badQuery.status).toBe(400);
  });

  it("updates plan pricing and metadata", async () => {
    const { app } = createTestApp();
    const { agent } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });
    const created = await createPlan(agent);
    const planId = (created.body as PlanResponse).plan.id;

    const updated = await agent
      .patch(API_PATHS.plan(planId))
      .set("Origin", TEST_ORIGIN)
      .send({
        name: "Pro Plus",
        description: null,
        price: { amountMinor: 9900, currency: "GBP" },
        interval: "YEAR",
        trialDays: 30,
      });

    expect(updated.status).toBe(200);
    const plan = (updated.body as PlanResponse).plan;
    expect(plan).toMatchObject({
      name: "Pro Plus",
      code: "pro",
      description: null,
      price: { amountMinor: 9900, currency: "GBP" },
      interval: "YEAR",
      trialDays: 30,
    });

    const detail = await agent.get(API_PATHS.plan(planId));
    expect((detail.body as PlanResponse).plan.name).toBe("Pro Plus");
  });

  it("archives and restores plans with status filters", async () => {
    const { app } = createTestApp();
    const { agent } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });
    const created = await createPlan(agent);
    const planId = (created.body as PlanResponse).plan.id;

    const archived = await agent
      .post(API_PATHS.planArchive(planId))
      .set("Origin", TEST_ORIGIN);
    expect(archived.status).toBe(200);
    expect((archived.body as PlanResponse).plan.status).toBe("ARCHIVED");

    const active = await agent.get(API_PATHS.plans);
    expect((active.body as PlanListResponse).total).toBe(0);

    const archivedList = await agent.get(`${API_PATHS.plans}?status=ARCHIVED`);
    expect((archivedList.body as PlanListResponse).total).toBe(1);

    const restored = await agent
      .post(API_PATHS.planRestore(planId))
      .set("Origin", TEST_ORIGIN);
    expect(restored.status).toBe(200);
    expect((restored.body as PlanResponse).plan.status).toBe("ACTIVE");
  });

  it("searches, filters, sorts, and paginates plans", async () => {
    const { app } = createTestApp();
    const { agent } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });

    await createPlan(agent, {
      name: "Basic",
      price: { amountMinor: 1000, currency: "USD" },
      interval: "MONTH",
    });
    await createPlan(agent, {
      name: "Growth",
      price: { amountMinor: 5000, currency: "EUR" },
      interval: "YEAR",
    });
    await createPlan(agent, {
      name: "Scale",
      price: { amountMinor: 20000, currency: "USD" },
      interval: "MONTH",
    });

    const cheapest = await agent.get(
      `${API_PATHS.plans}?sort=price&direction=asc&page=1&pageSize=1`,
    );
    const cheapestBody = cheapest.body as PlanListResponse;
    expect(cheapestBody.total).toBe(3);
    expect(cheapestBody.totalPages).toBe(3);
    expect(cheapestBody.plans[0]?.name).toBe("Basic");

    const yearly = await agent.get(`${API_PATHS.plans}?interval=YEAR`);
    expect((yearly.body as PlanListResponse).plans.map((plan) => plan.name)).toEqual([
      "Growth",
    ]);

    const search = await agent.get(`${API_PATHS.plans}?query=scale`);
    expect((search.body as PlanListResponse).total).toBe(1);
    expect((search.body as PlanListResponse).plans[0]?.name).toBe("Scale");
  });

  it("allows members to read but not mutate plans", async () => {
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
    const created = await createPlan(alice.agent);
    const planId = (created.body as PlanResponse).plan.id;

    store.addMember(alice.account.organizationId, bob.account.id, "MEMBER");
    await switchTo(bob.agent, alice.account.organizationId);

    const list = await bob.agent.get(API_PATHS.plans);
    expect(list.status).toBe(200);
    expect((list.body as PlanListResponse).total).toBe(1);

    expect(
      (
        await createPlan(bob.agent, {
          name: "Member Plan",
        })
      ).status,
    ).toBe(403);

    expect(
      (
        await bob.agent
          .patch(API_PATHS.plan(planId))
          .set("Origin", TEST_ORIGIN)
          .send({ name: "Hijacked Plan" })
      ).status,
    ).toBe(403);

    expect(
      (
        await bob.agent
          .post(API_PATHS.planArchive(planId))
          .set("Origin", TEST_ORIGIN)
      ).status,
    ).toBe(403);

    expect(
      (
        await bob.agent
          .delete(API_PATHS.plan(planId))
          .set("Origin", TEST_ORIGIN)
      ).status,
    ).toBe(403);

    store.addMember(alice.account.organizationId, bob.account.id, "ADMIN");
    expect(
      (
        await createPlan(bob.agent, {
          name: "Admin Plan",
        })
      ).status,
    ).toBe(201);
  });

  it("isolates plans across organizations", async () => {
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
    const created = await createPlan(alice.agent);
    const planId = (created.body as PlanResponse).plan.id;

    expect((await bob.agent.get(API_PATHS.plan(planId))).status).toBe(404);
    expect(
      (
        await bob.agent
          .patch(API_PATHS.plan(planId))
          .set("Origin", TEST_ORIGIN)
          .send({ name: "Cross tenant" })
      ).status,
    ).toBe(404);
    expect(
      (
        await bob.agent
          .post(API_PATHS.planArchive(planId))
          .set("Origin", TEST_ORIGIN)
      ).status,
    ).toBe(404);
    expect(
      (
        await bob.agent
          .delete(API_PATHS.plan(planId))
          .set("Origin", TEST_ORIGIN)
      ).status,
    ).toBe(404);

    const bobList = await bob.agent.get(`${API_PATHS.plans}?status=ALL`);
    expect((bobList.body as PlanListResponse).total).toBe(0);

    expect((await bob.agent.get("/api/plans/not-a-uuid")).status).toBe(400);
  });

  it("deletes unreferenced plans and blocks plans used by subscriptions", async () => {
    const { app, planStore } = createTestApp();
    const { agent, account } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });

    const removable = await createPlan(agent, { name: "Removable" });
    const removableId = (removable.body as PlanResponse).plan.id;

    const deleted = await agent
      .delete(API_PATHS.plan(removableId))
      .set("Origin", TEST_ORIGIN);
    expect(deleted.status).toBe(204);
    expect((await agent.get(API_PATHS.plan(removableId))).status).toBe(404);

    const referenced = await createPlan(agent, { name: "Referenced" });
    const referencedId = (referenced.body as PlanResponse).plan.id;
    planStore.addSubscriptionReference(account.organizationId, referencedId);

    const detail = await agent.get(API_PATHS.plan(referencedId));
    expect((detail.body as PlanResponse).plan.subscriptionCount).toBe(1);

    const blocked = await agent
      .delete(API_PATHS.plan(referencedId))
      .set("Origin", TEST_ORIGIN);
    expect(blocked.status).toBe(409);
    expect((blocked.body as ApiErrorResponse).error.code).toBe("CONFLICT");
    expect((await agent.get(API_PATHS.plan(referencedId))).status).toBe(200);

    const archived = await agent
      .post(API_PATHS.planArchive(referencedId))
      .set("Origin", TEST_ORIGIN);
    expect(archived.status).toBe(200);
  });
});
