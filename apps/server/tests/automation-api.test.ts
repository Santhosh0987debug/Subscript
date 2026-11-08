import { randomUUID } from "node:crypto";
import request from "supertest";
import { API_PATHS } from "@subscript/shared";
import type {
  AutomationDispatchResponse,
  AutomationJob,
  AutomationJobListResponse,
  AutomationJobResponse,
  AutomationNotificationListResponse,
  AutomationNotificationResponse,
  AutomationOverviewResponse,
} from "@subscript/shared";
import { describe, expect, it } from "vitest";
import type { NotificationEnqueueInput } from "../src/automation/notifications/types.js";
import type {
  AutomationJobRecord,
  CreateAutomationJobInput,
  CreateNotificationInput,
  NotificationRecord,
} from "../src/automation/types.js";
import { registerAccount } from "./helpers/accounts.js";
import type { Agent } from "./helpers/billing.js";
import { createAutomationSubscription } from "./helpers/automation.js";
import {
  createTestApp,
  TEST_ORIGIN,
  type TestApp,
} from "./helpers/test-app.js";

function jobInput(
  organizationId: string,
  overrides: Partial<CreateAutomationJobInput> = {},
): CreateAutomationJobInput {
  return {
    organizationId,
    type: "STATUS_SYNC",
    queue: "BILLING",
    idempotencyKey: `api:${randomUUID()}`,
    targetType: "SUBSCRIPTION",
    targetId: null,
    runAt: new Date(Date.now() - 1_000),
    maxAttempts: 3,
    ...overrides,
  };
}

async function createJob(
  test: TestApp,
  organizationId: string,
  overrides: Partial<CreateAutomationJobInput> = {},
): Promise<AutomationJobRecord> {
  const result = await test.automationStore.createJob(
    jobInput(organizationId, overrides),
  );

  return result.job;
}

async function createDeadLetterJob(
  test: TestApp,
  organizationId: string,
  overrides: Partial<CreateAutomationJobInput> = {},
): Promise<AutomationJobRecord> {
  const job = await createJob(test, organizationId, overrides);
  const now = new Date();

  await test.automationStore.claimJob(job.id, "api-test", now);
  await test.automationStore.failJob(
    job.id,
    { lastError: "Synthetic failure.", retryAt: null },
    now,
  );

  return job;
}

function notificationInput(
  organizationId: string,
  overrides: Partial<NotificationEnqueueInput> = {},
): NotificationEnqueueInput {
  return {
    organizationId,
    customerId: null,
    subscriptionId: null,
    invoiceId: null,
    type: "PAYMENT_SUCCEEDED",
    dedupeKey: `api:${randomUUID()}`,
    recipientEmail: "billing@acme.test",
    data: {
      organizationName: "API Test Organization",
      customerName: "Acme Industries",
      invoiceNumber: "INV-0001",
      amountMinor: 5_800,
      currency: "USD",
    },
    ...overrides,
  };
}

async function createDeadLetterNotification(
  test: TestApp,
  organizationId: string,
): Promise<NotificationRecord> {
  const enqueued = await test.notificationService.enqueue(
    notificationInput(organizationId),
  );
  const now = new Date();

  await test.automationStore.claimNotification(
    enqueued.notification.id,
    now,
  );
  await test.automationStore.failNotification(
    enqueued.notification.id,
    { lastError: "Synthetic delivery failure.", retryAt: null },
    now,
  );

  return enqueued.notification;
}

function switchTo(agent: Agent, organizationId: string) {
  return agent
    .post(API_PATHS.switchOrganization(organizationId))
    .set("Origin", TEST_ORIGIN);
}

describe("automation API", () => {
  it("requires authentication", async () => {
    const { app } = createTestApp();
    const response = await request(app).get(API_PATHS.automationOverview);

    expect(response.status).toBe(401);
  });

  it("returns queue health, summaries, and upcoming renewals", async () => {
    const test = createTestApp();
    const alice = await registerAccount(test.app, {
      name: "Alice Stone",
      email: "alice@example.com",
      organizationName: "Alice Workspace",
    });
    const organizationId = alice.account.organizationId;
    const subscription = await createAutomationSubscription(
      test,
      organizationId,
    );

    await createJob(test, organizationId, {
      type: "RENEWAL_REMINDER",
      targetId: subscription.id,
    });
    await createDeadLetterJob(test, organizationId, {
      type: "RECURRING_INVOICE",
      targetId: subscription.id,
    });
    await test.notificationService.enqueue(
      notificationInput(organizationId, {
        subscriptionId: subscription.id,
        customerId: subscription.customerId,
        type: "RENEWAL_UPCOMING",
        recipientEmail: subscription.customerEmail,
        data: {
          organizationName: "Alice Workspace",
          customerName: subscription.customerName,
          planName: subscription.planName,
          amountMinor: subscription.quantity * subscription.unitAmountMinor,
          currency: subscription.currency,
          effectiveDate: subscription.currentPeriodEnd,
        },
      }),
    );

    const response = await alice.agent.get(API_PATHS.automationOverview);

    expect(response.status).toBe(200);

    const body = response.body as AutomationOverviewResponse;

    expect(body.health.enabled).toBe(false);
    expect(body.health.redisConfigured).toBe(false);
    expect(body.health.workerStatus).toBe("unknown");
    expect(body.health.queues.map((queue) => queue.name)).toEqual([
      "BILLING",
      "NOTIFICATIONS",
    ]);
    expect(body.summary).toEqual({
      pendingJobs: 1,
      runningJobs: 0,
      failedJobs: 0,
      deadLetterJobs: 1,
      pendingNotifications: 1,
      failedNotifications: 0,
    });
    expect(body.renewalWindowDays).toBe(7);
    expect(body.upcomingRenewals).toHaveLength(1);
    expect(body.upcomingRenewals[0]).toMatchObject({
      subscriptionId: subscription.id,
      customerId: subscription.customerId,
      planName: subscription.planName,
      status: "ACTIVE",
      cancelAtPeriodEnd: false,
      amount: {
        amountMinor: subscription.quantity * subscription.unitAmountMinor,
        currency: subscription.currency,
      },
    });
    expect(body.upcomingRenewals[0]?.renewalDate).toBe(
      subscription.currentPeriodEnd.toISOString(),
    );
  });

  it("lists and filters jobs with sanitized fields", async () => {
    const test = createTestApp();
    const alice = await registerAccount(test.app, {
      name: "Alice Stone",
      email: "alice@example.com",
      organizationName: "Alice Workspace",
    });
    const organizationId = alice.account.organizationId;
    const pending = await createJob(test, organizationId, {
      type: "RENEWAL_REMINDER",
    });
    const completed = await createJob(test, organizationId, {
      type: "STATUS_SYNC",
    });
    const now = new Date();

    await test.automationStore.claimJob(completed.id, "api-test", now);
    await test.automationStore.completeJob(
      completed.id,
      "Completed in an API test.",
      now,
    );

    const response = await alice.agent
      .get(API_PATHS.automationJobs)
      .query({ status: "PENDING", type: "RENEWAL_REMINDER", page: 1, pageSize: 10 });

    expect(response.status).toBe(200);

    const body = response.body as AutomationJobListResponse;

    expect(body.total).toBe(1);
    expect(body.totalPages).toBe(1);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]?.id).toBe(pending.id);
    expect(body.counts).toMatchObject({ pending: 1, succeeded: 1 });

    const job = body.jobs[0] as AutomationJob;

    expect(job.targetType).toBe("SUBSCRIPTION");
    expect(job).not.toHaveProperty("idempotencyKey");
    expect(job).not.toHaveProperty("dispatchGeneration");
    expect(job).not.toHaveProperty("lockedBy");
    expect(job).not.toHaveProperty("lockedAt");

    const all = await alice.agent
      .get(API_PATHS.automationJobs)
      .query({ pageSize: 100 });

    expect((all.body as AutomationJobListResponse).total).toBe(2);

    const invalidStatus = await alice.agent
      .get(API_PATHS.automationJobs)
      .query({ status: "BOGUS" });

    expect(invalidStatus.status).toBe(400);
    expect(invalidStatus.body.error.code).toBe("VALIDATION_ERROR");

    const invalidPage = await alice.agent
      .get(API_PATHS.automationJobs)
      .query({ page: 0 });

    expect(invalidPage.status).toBe(400);

    const unknownQuery = await alice.agent
      .get(API_PATHS.automationJobs)
      .query({ search: "anything" });

    expect(unknownQuery.status).toBe(400);
  });

  it("lists and filters notifications without exposing message bodies", async () => {
    const test = createTestApp();
    const alice = await registerAccount(test.app, {
      name: "Alice Stone",
      email: "alice@example.com",
      organizationName: "Alice Workspace",
    });
    const organizationId = alice.account.organizationId;
    const sent = await test.notificationService.enqueue(
      notificationInput(organizationId, { type: "PAYMENT_SUCCEEDED" }),
    );
    await test.notificationService.enqueue(
      notificationInput(organizationId, { type: "PAYMENT_FAILED" }),
    );
    await test.notificationService.deliver(sent.notification.id);

    const response = await alice.agent
      .get(API_PATHS.automationNotifications)
      .query({ pageSize: 100 });

    expect(response.status).toBe(200);

    const body = response.body as AutomationNotificationListResponse;

    expect(body.total).toBe(2);
    expect(body.counts).toMatchObject({ pending: 1, sent: 1 });
    expect(body.notifications).toHaveLength(2);

    const delivered = body.notifications.find(
      (notification) => notification.status === "SENT",
    );

    expect(delivered?.sentAt).not.toBeNull();
    expect(delivered).not.toHaveProperty("bodyText");
    expect(delivered).not.toHaveProperty("bodyHtml");
    expect(delivered).not.toHaveProperty("dedupeKey");

    const filtered = await alice.agent
      .get(API_PATHS.automationNotifications)
      .query({ type: "PAYMENT_FAILED" });

    expect((filtered.body as AutomationNotificationListResponse).total).toBe(1);

    const invalidStatus = await alice.agent
      .get(API_PATHS.automationNotifications)
      .query({ status: "NOT_REAL" });

    expect(invalidStatus.status).toBe(400);
  });

  it("restricts retries to admins and scopes them to the organization", async () => {
    const test = createTestApp();
    const alice = await registerAccount(test.app, {
      name: "Alice Stone",
      email: "alice@example.com",
      organizationName: "Alice Workspace",
    });
    const bob = await registerAccount(test.app, {
      name: "Bob Reed",
      email: "bob@example.com",
      organizationName: "Bob Workspace",
    });
    const mallory = await registerAccount(test.app, {
      name: "Mallory Vale",
      email: "mallory@example.com",
      organizationName: "Mallory Workspace",
    });
    const organizationId = alice.account.organizationId;
    const job = await createDeadLetterJob(test, organizationId);
    const memberJob = await createDeadLetterJob(test, organizationId);

    test.store.addMember(
      organizationId,
      bob.account.id,
      "MEMBER",
    );
    await switchTo(bob.agent, organizationId);

    expect(
      (await bob.agent.get(API_PATHS.automationJobs)).status,
    ).toBe(200);

    const memberRetry = await bob.agent
      .post(API_PATHS.automationJobRetry(memberJob.id))
      .set("Origin", TEST_ORIGIN);

    expect(memberRetry.status).toBe(403);

    const retried = await alice.agent
      .post(API_PATHS.automationJobRetry(job.id))
      .set("Origin", TEST_ORIGIN);

    expect(retried.status).toBe(200);

    const retriedJob = (retried.body as AutomationJobResponse).job;

    expect(retriedJob.status).toBe("PENDING");
    expect(retriedJob.attempts).toBe(0);

    const repeated = await alice.agent
      .post(API_PATHS.automationJobRetry(job.id))
      .set("Origin", TEST_ORIGIN);

    expect(repeated.status).toBe(404);

    const crossTenant = await mallory.agent
      .post(API_PATHS.automationJobRetry(job.id))
      .set("Origin", TEST_ORIGIN);

    expect(crossTenant.status).toBe(404);
    expect(
      (await mallory.agent.get(API_PATHS.automationJobs)).body.total,
    ).toBe(0);

    const invalidId = await alice.agent
      .post("/api/automation/jobs/not-a-uuid/retry")
      .set("Origin", TEST_ORIGIN);

    expect(invalidId.status).toBe(400);
  });

  it("restricts notification retries to admins with tenant isolation", async () => {
    const test = createTestApp();
    const alice = await registerAccount(test.app, {
      name: "Alice Stone",
      email: "alice@example.com",
      organizationName: "Alice Workspace",
    });
    const bob = await registerAccount(test.app, {
      name: "Bob Reed",
      email: "bob@example.com",
      organizationName: "Bob Workspace",
    });
    const mallory = await registerAccount(test.app, {
      name: "Mallory Vale",
      email: "mallory@example.com",
      organizationName: "Mallory Workspace",
    });
    const organizationId = alice.account.organizationId;
    const notification = await createDeadLetterNotification(
      test,
      organizationId,
    );
    const memberNotification = await createDeadLetterNotification(
      test,
      organizationId,
    );

    test.store.addMember(organizationId, bob.account.id, "MEMBER");
    await switchTo(bob.agent, organizationId);

    expect(
      (await bob.agent.get(API_PATHS.automationNotifications)).status,
    ).toBe(200);

    const memberRetry = await bob.agent
      .post(API_PATHS.automationNotificationRetry(memberNotification.id))
      .set("Origin", TEST_ORIGIN);

    expect(memberRetry.status).toBe(403);

    const retried = await alice.agent
      .post(API_PATHS.automationNotificationRetry(notification.id))
      .set("Origin", TEST_ORIGIN);

    expect(retried.status).toBe(200);

    const retriedNotification = (
      retried.body as AutomationNotificationResponse
    ).notification;

    expect(retriedNotification.status).toBe("PENDING");
    expect(retriedNotification.attempts).toBe(0);

    const repeated = await alice.agent
      .post(API_PATHS.automationNotificationRetry(notification.id))
      .set("Origin", TEST_ORIGIN);

    expect(repeated.status).toBe(404);

    const crossTenant = await mallory.agent
      .post(API_PATHS.automationNotificationRetry(notification.id))
      .set("Origin", TEST_ORIGIN);

    expect(crossTenant.status).toBe(404);

    const invalidId = await alice.agent
      .post("/api/automation/notifications/not-a-uuid/retry")
      .set("Origin", TEST_ORIGIN);

    expect(invalidId.status).toBe(400);
  });

  it("dispatches due outbox rows for admins only", async () => {
    const dispatchedJobs: string[] = [];
    const dispatchedNotifications: string[] = [];
    const test = createTestApp({
      automationDispatcher: {
        async dispatchJob(job: AutomationJobRecord) {
          await test.automationStore.markJobQueued(
            job.id,
            job.dispatchGeneration,
            new Date(),
          );
          dispatchedJobs.push(job.id);
          return true;
        },
      },
      notificationDispatcher: {
        async dispatchNotification(notification: NotificationRecord) {
          await test.automationStore.markNotificationQueued(
            notification.id,
            new Date(),
          );
          dispatchedNotifications.push(notification.id);
          return true;
        },
      },
    });
    const alice = await registerAccount(test.app, {
      name: "Alice Stone",
      email: "alice@example.com",
      organizationName: "Alice Workspace",
    });
    const bob = await registerAccount(test.app, {
      name: "Bob Reed",
      email: "bob@example.com",
      organizationName: "Bob Workspace",
    });
    const organizationId = alice.account.organizationId;
    const job = await createJob(test, organizationId);
    const notificationInputValue: CreateNotificationInput = {
      ...notificationInput(organizationId),
      subject: "Payment received",
      bodyText: "A payment was received.",
      bodyHtml: "<p>A payment was received.</p>",
      maxAttempts: 5,
    };
    const notification =
      await test.automationStore.createNotification(notificationInputValue);

    const response = await alice.agent
      .post(API_PATHS.automationDispatch)
      .set("Origin", TEST_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.body as AutomationDispatchResponse).toEqual({
      queuedJobs: 1,
      queuedNotifications: 1,
    });
    expect(dispatchedJobs).toEqual([job.id]);
    expect(dispatchedNotifications).toEqual([notification.notification.id]);

    const queuedJob = await test.automationStore.findJob(
      organizationId,
      job.id,
    );
    const queuedNotification = await test.automationStore.findNotification(
      organizationId,
      notification.notification.id,
    );

    expect(queuedJob?.status).toBe("QUEUED");
    expect(queuedNotification?.status).toBe("QUEUED");

    test.store.addMember(organizationId, bob.account.id, "MEMBER");
    await switchTo(bob.agent, organizationId);

    const memberDispatch = await bob.agent
      .post(API_PATHS.automationDispatch)
      .set("Origin", TEST_ORIGIN);

    expect(memberDispatch.status).toBe(403);
  });
});
