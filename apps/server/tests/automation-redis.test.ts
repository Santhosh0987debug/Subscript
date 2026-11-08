import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAutomationQueueClient,
  type AutomationQueueClient,
} from "../src/automation/queue/client.js";
import {
  createAutomationWorkers,
  type AutomationWorkers,
} from "../src/automation/queue/worker.js";
import type {
  AutomationJobRecord,
  NotificationRecord,
} from "../src/automation/types.js";
import { createAutomationSubscription } from "./helpers/automation.js";
import { createTestApp } from "./helpers/test-app.js";

/**
 * Real Redis/BullMQ checks for transport dispatch, heartbeats, scheduler
 * registration and worker round-trips. Enabled only when TEST_REDIS_URL points
 * at a disposable Redis instance.
 */
const redisUrl = process.env.TEST_REDIS_URL;

async function waitForValue<T>(
  read: () => Promise<T | null>,
  isDone: (value: T) => boolean,
  label: string,
): Promise<T> {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const value = await read();

    if (value && isDone(value)) {
      return value;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

describe.skipIf(!redisUrl)("automation Redis/BullMQ integration", () => {
  const test = createTestApp();
  const prefix = `subscript-test-${randomUUID().slice(0, 12)}`;
  let client: AutomationQueueClient | null = null;
  const workers: AutomationWorkers[] = [];

  function queueClient(): AutomationQueueClient {
    if (!client) {
      throw new Error("The Redis queue client was not created.");
    }

    return client;
  }

  beforeAll(() => {
    client = createAutomationQueueClient({
      redisUrl: redisUrl ?? "",
      prefix,
      store: test.automationStore,
    });
  });

  afterAll(async () => {
    for (const worker of workers) {
      await worker.close();
    }

    if (client) {
      await client.billing
        .obliterate({ force: true })
        .catch(() => undefined);
      await client.notifications
        .obliterate({ force: true })
        .catch(() => undefined);
      await client.close();
    }
  });

  it("dispatches durable jobs once, registers the sweep, and reports health", async () => {
    const organizationId = randomUUID();
    const subscription = await createAutomationSubscription(
      test,
      organizationId,
    );
    test.automationCandidates.seedSubscription({
      organizationId,
      organizationName: "Redis Integration",
      subscriptionId: subscription.id,
      customerId: subscription.customerId,
      customerName: subscription.customerName,
      customerEmail: subscription.customerEmail,
      planName: subscription.planName,
      status: subscription.status,
      quantity: subscription.quantity,
      unitAmountMinor: subscription.unitAmountMinor,
      currency: subscription.currency,
      interval: subscription.interval,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      trialEndsAt: subscription.trialEndsAt,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    });

    await test.automationService.runSweep(new Date());
    const jobs = await test.automationStore.listJobs(organizationId, {
      status: "ALL",
      type: "ALL",
      page: 1,
      pageSize: 100,
    });
    const job = jobs.items.find(
      (candidate) => candidate.type === "RENEWAL_REMINDER",
    );

    expect(job).toBeDefined();
    expect(await queueClient().dispatcher.dispatchJob(job!)).toBe(true);

    const queued = await test.automationStore.findJob(
      organizationId,
      job!.id,
    );

    expect(queued?.status).toBe("QUEUED");
    expect(await queueClient().dispatcher.dispatchJob(queued!)).toBe(false);

    const waiting = await queueClient().billing.getJobCounts("waiting");

    expect(waiting.waiting).toBeGreaterThanOrEqual(1);

    await queueClient().ensureSweepSchedule(60_000);
    expect(
      await queueClient().billing.getJobSchedulersCount(),
    ).toBeGreaterThanOrEqual(1);

    const seenAt = new Date();
    await queueClient().writeWorkerHeartbeat("redis-health-worker", seenAt);

    const health = await queueClient().readHealth();

    expect(health.enabled).toBe(true);
    expect(health.redisConfigured).toBe(true);
    expect(health.workerStatus).toBe("online");
    expect(health.lastWorkerSeenAt).toBe(seenAt.toISOString());
    expect(health.queues).toHaveLength(2);
    expect(health.queues.every((queue) => queue.connected)).toBe(true);
  });

  it("round-trips jobs and notifications through a worker and restarts", async () => {
    const organizationId = randomUUID();
    const job = await test.automationStore.createJob({
      organizationId,
      type: "STATUS_SYNC",
      queue: "BILLING",
      idempotencyKey: `redis-job-1:${randomUUID()}`,
      targetType: "SUBSCRIPTION",
      targetId: null,
      runAt: new Date(Date.now() - 1_000),
      maxAttempts: 3,
    });
    const notification = await test.automationStore.createNotification({
      organizationId,
      customerId: null,
      subscriptionId: null,
      invoiceId: null,
      type: "PAYMENT_SUCCEEDED",
      dedupeKey: `redis-notification:${randomUUID()}`,
      recipientEmail: "billing@acme.test",
      subject: "Payment received",
      bodyText: "A payment was received.",
      bodyHtml: "<p>A payment was received.</p>",
      maxAttempts: 3,
    });

    expect(await queueClient().dispatcher.dispatchJob(job.job)).toBe(true);
    expect(
      await queueClient().dispatcher.dispatchNotification(
        notification.notification,
      ),
    ).toBe(true);

    const firstWorker = createAutomationWorkers({
      redisUrl: redisUrl ?? "",
      prefix,
      billingConcurrency: 1,
      notificationConcurrency: 1,
      workerId: "redis-worker-1",
      service: test.automationService,
      notifications: test.notificationService,
    });
    workers.push(firstWorker);

    const completedJob = await waitForValue<AutomationJobRecord>(
      () => test.automationStore.findJob(organizationId, job.job.id),
      (value) => value.status === "SUCCEEDED",
      "the billing job to complete",
    );
    const sentNotification = await waitForValue<NotificationRecord>(
      () =>
        test.automationStore.findNotification(
          organizationId,
          notification.notification.id,
        ),
      (value) => value.status === "SENT",
      "the notification to send",
    );

    expect(completedJob.attempts).toBe(1);
    expect(sentNotification.providerName).toBe("test");

    await firstWorker.close();
    workers.splice(workers.indexOf(firstWorker), 1);

    const restartedJob = await test.automationStore.createJob({
      organizationId,
      type: "STATUS_SYNC",
      queue: "BILLING",
      idempotencyKey: `redis-job-2:${randomUUID()}`,
      targetType: "SUBSCRIPTION",
      targetId: null,
      runAt: new Date(Date.now() - 1_000),
      maxAttempts: 3,
    });

    expect(
      await queueClient().dispatcher.dispatchJob(restartedJob.job),
    ).toBe(true);

    const restartedWorker = createAutomationWorkers({
      redisUrl: redisUrl ?? "",
      prefix,
      billingConcurrency: 1,
      notificationConcurrency: 1,
      workerId: "redis-worker-2",
      service: test.automationService,
      notifications: test.notificationService,
    });
    workers.push(restartedWorker);

    const restartedCompleted = await waitForValue<AutomationJobRecord>(
      () =>
        test.automationStore.findJob(organizationId, restartedJob.job.id),
      (value) => value.status === "SUCCEEDED",
      "the restarted billing job to complete",
    );

    expect(restartedCompleted.attempts).toBe(1);
  });
});
