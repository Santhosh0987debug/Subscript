import { randomUUID } from "node:crypto";
import type request from "supertest";
import { describe, expect, it } from "vitest";
import {
  API_PATHS,
  type ApiErrorResponse,
  type CustomerMutationResponse,
  type PlanResponse,
  type SubscriptionListResponse,
  type SubscriptionMutationResponse,
  type SubscriptionResponse,
} from "@subscript/shared";
import { TEST_ORIGIN, createTestApp } from "./helpers/test-app.js";
import {
  createCustomer,
  createPlan,
  createSubscription,
  registerBillingAccount,
  setupSubscription,
} from "./helpers/billing.js";

type Agent = ReturnType<typeof request.agent>;

function subscriptionPayload(
  customerId: string,
  planId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    customerId,
    planId,
    startDate: "2026-01-01",
    ...overrides,
  };
}

async function registerOwner(app: ReturnType<typeof createTestApp>["app"]) {
  return registerBillingAccount(app, {
    name: "Alice Stone",
    email: "alice@example.com",
    organizationName: "Alice Workspace",
  });
}

async function lifecycle(
  agent: Agent,
  subscriptionId: string,
  action: string,
  body?: Record<string, unknown>,
) {
  const path =
    action === "mark-past-due"
      ? API_PATHS.subscriptionMarkPastDue(subscriptionId)
      : action === "pause"
        ? API_PATHS.subscriptionPause(subscriptionId)
        : action === "resume"
          ? API_PATHS.subscriptionResume(subscriptionId)
          : action === "cancel"
            ? API_PATHS.subscriptionCancel(subscriptionId)
            : action === "renew"
              ? API_PATHS.subscriptionRenew(subscriptionId)
              : API_PATHS.subscriptionExpire(subscriptionId);

  return agent
    .post(path)
    .set("Origin", TEST_ORIGIN)
    .send(body ?? {});
}

describe("subscriptions", () => {
  it("creates an active subscription with a plan price snapshot", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const customerResponse = await createCustomer(agent);
    const planResponse = await createPlan(agent, {
      price: { amountMinor: 2_900, currency: "USD" },
      interval: "MONTH",
      trialDays: 0,
    });
    const customer = (customerResponse.body as CustomerMutationResponse).customer;
    const plan = (planResponse.body as PlanResponse).plan;
    const created = await createSubscription(
      agent,
      subscriptionPayload(customer.id, plan.id, {
        startDate: "2026-01-31",
        quantity: 2,
      }),
    );

    expect(created.status).toBe(201);
    expect(created.headers.location).toBe(
      API_PATHS.subscription(
        (created.body as SubscriptionMutationResponse).subscription.id,
      ),
    );

    const subscription = (created.body as SubscriptionMutationResponse)
      .subscription;

    expect(subscription).toMatchObject({
      status: "ACTIVE",
      customerId: customer.id,
      customerName: customer.name,
      planId: plan.id,
      planName: "Growth",
      planCode: plan.code,
      quantity: 2,
      interval: "MONTH",
      trialDays: 0,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      currentPeriodStart: "2026-01-31T00:00:00.000Z",
      currentPeriodEnd: "2026-02-28T00:00:00.000Z",
      nextBillingDate: "2026-02-28T00:00:00.000Z",
    });
    expect(subscription.price).toEqual({
      amountMinor: 2_900,
      currency: "USD",
    });
    expect(subscription.outstanding).toEqual({
      amountMinor: 0,
      currency: "USD",
    });

    const updatedPlan = await agent
      .patch(API_PATHS.plan(plan.id))
      .set("Origin", TEST_ORIGIN)
      .send({ price: { amountMinor: 4_900, currency: "USD" } });
    expect(updatedPlan.status).toBe(200);

    const detail = await agent.get(API_PATHS.subscription(subscription.id));
    expect(detail.status).toBe(200);
    const detailBody = detail.body as SubscriptionResponse;

    expect(detailBody.subscription.price.amountMinor).toBe(2_900);

    const planDetail = await agent.get(API_PATHS.plan(plan.id));
    expect((planDetail.body as PlanResponse).plan.subscriptionCount).toBe(1);
  });

  it("starts a trial and converts it without advancing the paid period", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const customerResponse = await createCustomer(agent);
    const planResponse = await createPlan(agent, {
      trialDays: 14,
      price: { amountMinor: 2_900, currency: "USD" },
      interval: "MONTH",
    });
    const customer = (customerResponse.body as CustomerMutationResponse).customer;
    const plan = (planResponse.body as PlanResponse).plan;
    const created = await createSubscription(
      agent,
      subscriptionPayload(customer.id, plan.id, { startDate: "2026-05-01" }),
    );

    const subscription = (created.body as SubscriptionMutationResponse)
      .subscription;

    expect(subscription).toMatchObject({
      status: "TRIALING",
      trialDays: 14,
      trialEndsAt: "2026-05-15T00:00:00.000Z",
      currentPeriodStart: "2026-05-15T00:00:00.000Z",
      currentPeriodEnd: "2026-06-15T00:00:00.000Z",
      nextBillingDate: "2026-05-15T00:00:00.000Z",
    });

    const renewed = await lifecycle(agent, subscription.id, "renew");
    expect(renewed.status).toBe(200);

    const active = (renewed.body as SubscriptionMutationResponse).subscription;

    expect(active.status).toBe("ACTIVE");
    expect(active.currentPeriodStart).toBe("2026-05-15T00:00:00.000Z");
    expect(active.currentPeriodEnd).toBe("2026-06-15T00:00:00.000Z");
    expect(active.nextBillingDate).toBe("2026-06-15T00:00:00.000Z");
    expect(active.trialEndsAt).toBe("2026-05-15T00:00:00.000Z");
  });

  it("supports trial overrides, custom period ends, and leap-year clamping", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const customerResponse = await createCustomer(agent);
    const yearlyPlan = await createPlan(agent, {
      name: "Annual",
      interval: "YEAR",
      trialDays: 0,
    });
    const trialPlan = await createPlan(agent, {
      name: "Trial Plan",
      interval: "MONTH",
      trialDays: 14,
    });
    const customer = (customerResponse.body as CustomerMutationResponse).customer;
    const yearly = (yearlyPlan.body as PlanResponse).plan;
    const trial = (trialPlan.body as PlanResponse).plan;

    const leap = await createSubscription(
      agent,
      subscriptionPayload(customer.id, yearly.id, {
        startDate: "2028-02-29",
      }),
    );
    expect(leap.status).toBe(201);
    expect(
      (leap.body as SubscriptionMutationResponse).subscription.currentPeriodEnd,
    ).toBe("2029-02-28T00:00:00.000Z");

    const custom = await createSubscription(
      agent,
      subscriptionPayload(customer.id, yearly.id, {
        startDate: "2028-02-29",
        nextBillingDate: "2028-03-15",
      }),
    );
    expect(custom.status).toBe(201);
    expect(
      (custom.body as SubscriptionMutationResponse).subscription.currentPeriodEnd,
    ).toBe("2028-03-15T00:00:00.000Z");

    const overriddenTrial = await createSubscription(
      agent,
      subscriptionPayload(customer.id, trial.id, {
        startDate: "2026-01-28",
        trialDays: 7,
        nextBillingDate: "2026-02-10",
      }),
    );
    expect(overriddenTrial.status).toBe(201);
    expect(
      (overriddenTrial.body as SubscriptionMutationResponse).subscription,
    ).toMatchObject({
      status: "TRIALING",
      trialDays: 7,
      trialEndsAt: "2026-02-04T00:00:00.000Z",
      currentPeriodStart: "2026-02-04T00:00:00.000Z",
      currentPeriodEnd: "2026-02-10T00:00:00.000Z",
      nextBillingDate: "2026-02-04T00:00:00.000Z",
    });
  });

  it("runs the full pause, resume, renewal, past-due, and cancellation flow", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const setup = await setupSubscription(agent, {
      subscription: { startDate: "2026-01-01" },
    });

    const paused = await lifecycle(agent, setup.subscription.id, "pause");
    expect(paused.status).toBe(200);
    expect(
      (paused.body as SubscriptionMutationResponse).subscription,
    ).toMatchObject({ status: "PAUSED" });
    expect(
      (paused.body as SubscriptionMutationResponse).subscription.pausedAt,
    ).not.toBeNull();

    expect(
      (await lifecycle(agent, setup.subscription.id, "pause")).status,
    ).toBe(409);

    const resumed = await lifecycle(agent, setup.subscription.id, "resume");
    expect(resumed.status).toBe(200);
    expect(
      (resumed.body as SubscriptionMutationResponse).subscription,
    ).toMatchObject({ status: "ACTIVE", pausedAt: null });

    const renewed = await lifecycle(agent, setup.subscription.id, "renew");
    expect(renewed.status).toBe(200);
    expect(
      (renewed.body as SubscriptionMutationResponse).subscription,
    ).toMatchObject({
      status: "ACTIVE",
      currentPeriodStart: "2026-02-01T00:00:00.000Z",
      currentPeriodEnd: "2026-03-01T00:00:00.000Z",
    });

    const pastDue = await lifecycle(agent, setup.subscription.id, "mark-past-due");
    expect(pastDue.status).toBe(200);
    expect(
      (pastDue.body as SubscriptionMutationResponse).subscription.status,
    ).toBe("PAST_DUE");

    const recovered = await lifecycle(agent, setup.subscription.id, "renew");
    expect(recovered.status).toBe(200);
    expect(
      (recovered.body as SubscriptionMutationResponse).subscription,
    ).toMatchObject({
      status: "ACTIVE",
      currentPeriodStart: "2026-03-01T00:00:00.000Z",
      currentPeriodEnd: "2026-04-01T00:00:00.000Z",
    });

    const scheduled = await lifecycle(agent, setup.subscription.id, "cancel");
    expect(scheduled.status).toBe(200);
    expect(
      (scheduled.body as SubscriptionMutationResponse).subscription,
    ).toMatchObject({
      status: "ACTIVE",
      cancelAtPeriodEnd: true,
      endedAt: null,
    });

    expect(
      (await lifecycle(agent, setup.subscription.id, "cancel")).status,
    ).toBe(409);

    const canceled = await lifecycle(agent, setup.subscription.id, "renew");
    expect(canceled.status).toBe(200);
    expect(
      (canceled.body as SubscriptionMutationResponse).subscription,
    ).toMatchObject({
      status: "CANCELED",
      cancelAtPeriodEnd: false,
    });
    expect(
      (canceled.body as SubscriptionMutationResponse).subscription.endedAt,
    ).not.toBeNull();

    expect(
      (await lifecycle(agent, setup.subscription.id, "renew")).status,
    ).toBe(409);

    const expiredAfterCancellation = await lifecycle(
      agent,
      setup.subscription.id,
      "expire",
    );
    expect(expiredAfterCancellation.status).toBe(200);
    expect(
      (expiredAfterCancellation.body as SubscriptionMutationResponse)
        .subscription.status,
    ).toBe("EXPIRED");
    expect(
      (await lifecycle(agent, setup.subscription.id, "expire")).status,
    ).toBe(409);

    const detail = await agent.get(
      API_PATHS.subscription(setup.subscription.id),
    );
    const activities = (detail.body as SubscriptionResponse).activities;
    expect(activities.map((activity) => activity.type)).toEqual(
      expect.arrayContaining([
        "CREATED",
        "PAUSED",
        "RESUMED",
        "RENEWED",
        "PAST_DUE",
        "CANCEL_SCHEDULED",
        "CANCELED",
      ]),
    );
    expect(activities.every((activity) => activity.actorName === "Alice Stone")).toBe(
      true,
    );
  });

  it("supports immediate cancellation, expiry, and rejects invalid transitions", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const first = await setupSubscription(agent, {
      subscription: { startDate: "2026-01-01" },
    });

    expect(
      (await lifecycle(agent, first.subscription.id, "resume")).status,
    ).toBe(409);
    expect(
      (await lifecycle(agent, first.subscription.id, "mark-past-due")).status,
    ).toBe(200);
    expect(
      (await lifecycle(agent, first.subscription.id, "pause")).status,
    ).toBe(409);

    const immediate = await lifecycle(agent, first.subscription.id, "cancel", {
      atPeriodEnd: false,
    });
    expect(immediate.status).toBe(200);
    expect(
      (immediate.body as SubscriptionMutationResponse).subscription,
    ).toMatchObject({
      status: "CANCELED",
      cancelAtPeriodEnd: false,
    });
    expect(
      (immediate.body as SubscriptionMutationResponse).subscription.endedAt,
    ).not.toBeNull();

    const second = await setupSubscription(agent, {
      subscription: { startDate: "2026-01-01" },
      customer: { email: "second@acme.test" },
      plan: { name: "Second Plan" },
    });
    const expired = await lifecycle(agent, second.subscription.id, "expire");
    expect(expired.status).toBe(200);
    expect(
      (expired.body as SubscriptionMutationResponse).subscription.status,
    ).toBe("EXPIRED");
    expect(
      (await lifecycle(agent, second.subscription.id, "expire")).status,
    ).toBe(409);
  });

  it("filters and paginates subscriptions", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const alpha = await setupSubscription(agent, {
      customer: { name: "Alpha Co", email: "alpha@example.com" },
      subscription: { startDate: "2026-01-01" },
    });
    const beta = await setupSubscription(agent, {
      customer: { name: "Beta Co", email: "beta@example.com" },
      plan: { name: "Beta Plan" },
      subscription: { startDate: "2026-02-01" },
    });
    await lifecycle(agent, beta.subscription.id, "expire");

    const active = await agent.get(
      `${API_PATHS.subscriptions}?status=ACTIVE`,
    );
    expect(active.status).toBe(200);
    expect((active.body as SubscriptionListResponse).total).toBe(1);
    expect((active.body as SubscriptionListResponse).subscriptions[0]?.id).toBe(
      alpha.subscription.id,
    );

    const expired = await agent.get(
      `${API_PATHS.subscriptions}?status=EXPIRED`,
    );
    expect((expired.body as SubscriptionListResponse).total).toBe(1);
    expect(
      (expired.body as SubscriptionListResponse).subscriptions[0]?.customerName,
    ).toBe("Beta Co");

    const search = await agent.get(
      `${API_PATHS.subscriptions}?query=beta&status=ALL`,
    );
    expect((search.body as SubscriptionListResponse).total).toBe(1);

    const paged = await agent.get(
      `${API_PATHS.subscriptions}?status=ALL&page=2&pageSize=1`,
    );
    expect(paged.status).toBe(200);
    expect((paged.body as SubscriptionListResponse).page).toBe(2);
    expect((paged.body as SubscriptionListResponse).totalPages).toBe(2);
  });

  it("validates dates, quantities, archived records, and unknown fields", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);
    const customerResponse = await createCustomer(agent);
    const planResponse = await createPlan(agent);
    const customer = (customerResponse.body as CustomerMutationResponse).customer;
    const plan = (planResponse.body as PlanResponse).plan;

    const impossibleDate = await createSubscription(
      agent,
      subscriptionPayload(customer.id, plan.id, { startDate: "2026-02-30" }),
    );
    expect(impossibleDate.status).toBe(400);
    expect(
      (impossibleDate.body as ApiErrorResponse).error.details?.some(
        (issue) => issue.path === "startDate",
      ),
    ).toBe(true);

    const badOverride = await createSubscription(
      agent,
      subscriptionPayload(customer.id, plan.id, {
        startDate: "2026-01-01",
        nextBillingDate: "2026-01-01",
      }),
    );
    expect(badOverride.status).toBe(400);

    const zeroQuantity = await createSubscription(
      agent,
      subscriptionPayload(customer.id, plan.id, { quantity: 0 }),
    );
    expect(zeroQuantity.status).toBe(400);

    const unknownField = await createSubscription(
      agent,
      subscriptionPayload(customer.id, plan.id, { total: 1 }),
    );
    expect(unknownField.status).toBe(400);

    const missingPlan = await createSubscription(
      agent,
      subscriptionPayload(customer.id, randomUUID()),
    );
    expect(missingPlan.status).toBe(404);

    await agent
      .post(API_PATHS.customerArchive(customer.id))
      .set("Origin", TEST_ORIGIN);
    const archivedCustomer = await createSubscription(
      agent,
      subscriptionPayload(customer.id, plan.id),
    );
    expect(archivedCustomer.status).toBe(409);

    const restoredCustomer = await createCustomer(agent, {
      name: "Restored Co",
      email: "restored@example.com",
    });
    await agent.post(API_PATHS.planArchive(plan.id)).set("Origin", TEST_ORIGIN);
    const archivedPlan = await createSubscription(
      agent,
      subscriptionPayload(
        (restoredCustomer.body as CustomerMutationResponse).customer.id,
        plan.id,
      ),
    );
    expect(archivedPlan.status).toBe(409);
  });

  it("enforces member roles and organization isolation", async () => {
    const { app, store } = createTestApp();
    const alice = await registerOwner(app);
    const setup = await setupSubscription(alice.agent, {
      subscription: { startDate: "2026-01-01" },
    });
    const bob = await registerBillingAccount(app, {
      name: "Bob Reed",
      email: "bob@example.com",
      organizationName: "Bob Workspace",
    });

    store.addMember(
      alice.account.organizationId,
      bob.account.id,
      "MEMBER",
    );
    await bob.agent
      .post(API_PATHS.switchOrganization(alice.account.organizationId))
      .set("Origin", TEST_ORIGIN);

    expect((await bob.agent.get(API_PATHS.subscriptions)).status).toBe(200);
    expect(
      (
        await bob.agent.get(
          API_PATHS.subscription(setup.subscription.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await createSubscription(bob.agent, {
          customerId: setup.customer.id,
          planId: setup.plan.id,
          startDate: "2026-01-01",
        })
      ).status,
    ).toBe(403);
    expect(
      (await lifecycle(bob.agent, setup.subscription.id, "pause")).status,
    ).toBe(403);
    expect(
      (
        await bob.agent
          .post(API_PATHS.subscriptionInvoices(setup.subscription.id))
          .set("Origin", TEST_ORIGIN)
          .send({ taxRateBps: 0 })
      ).status,
    ).toBe(403);

    store.addMember(alice.account.organizationId, bob.account.id, "ADMIN");
    expect(
      (await lifecycle(bob.agent, setup.subscription.id, "pause")).status,
    ).toBe(200);

    const outsider = await registerBillingAccount(app, {
      name: "Mallory",
      email: "mallory@example.com",
      organizationName: "Mallory Workspace",
    });
    expect(
      (
        await outsider.agent.get(
          API_PATHS.subscription(setup.subscription.id),
        )
      ).status,
    ).toBe(404);
    expect(
      (await lifecycle(outsider.agent, setup.subscription.id, "pause")).status,
    ).toBe(404);
    expect(
      (
        await outsider.agent
          .post(API_PATHS.subscriptionInvoices(setup.subscription.id))
          .set("Origin", TEST_ORIGIN)
          .send({ taxRateBps: 0 })
      ).status,
    ).toBe(404);
    expect(
      (
        await createSubscription(outsider.agent, {
          customerId: setup.customer.id,
          planId: setup.plan.id,
          startDate: "2026-01-01",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await outsider.agent.get(`${API_PATHS.subscriptions}?status=ALL`)
      ).status,
    ).toBe(200);
    expect(
      (
        (await outsider.agent.get(`${API_PATHS.subscriptions}?status=ALL`))
          .body as SubscriptionListResponse
      ).total,
    ).toBe(0);
  });

  it("returns 400 for malformed ids and 404 for unknown subscriptions", async () => {
    const { app } = createTestApp();
    const { agent } = await registerOwner(app);

    expect((await agent.get("/api/subscriptions/not-a-uuid")).status).toBe(400);
    expect(
      (await agent.get(API_PATHS.subscription(randomUUID()))).status,
    ).toBe(404);
    expect(
      (await lifecycle(agent, randomUUID(), "pause")).status,
    ).toBe(404);
  });
});
