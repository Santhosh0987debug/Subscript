import { randomUUID } from "node:crypto";
import { addBillingInterval } from "@subscript/shared";
import { describe, expect, it, vi } from "vitest";
import { boundedExponentialDelay } from "../src/automation/backoff.js";
import type { NotificationService } from "../src/automation/notifications/service.js";
import { createNotificationService } from "../src/automation/notifications/service.js";
import type { EmailProvider } from "../src/automation/notifications/types.js";
import {
  createAutomationService,
  type AutomationServiceConfig,
} from "../src/automation/service.js";
import type { NotificationRecord } from "../src/automation/types.js";
import { parseEnv } from "../src/config/env.js";
import {
  automationOrganizationName,
  createAutomationInvoice,
  createAutomationSubscription,
  createFailedGatewayPayment,
  findAutomationJob,
  listAutomationJobs,
  seedAutomationSubscription,
  seedFailedPayment,
} from "./helpers/automation.js";
import { createTestApp, type TestApp } from "./helpers/test-app.js";

const DAY_MS = 86_400_000;

function automationConfig(
  overrides: Partial<AutomationServiceConfig> = {},
): AutomationServiceConfig {
  const defaults = parseEnv({ NODE_ENV: "test" }).automation;

  return {
    renewalReminderWindowDays: defaults.renewalReminderWindowDays,
    trialReminderWindowDays: defaults.trialReminderWindowDays,
    invoiceDueInDays: defaults.invoiceDueInDays,
    invoiceTaxRateBps: defaults.invoiceTaxRateBps,
    jobMaxAttempts: defaults.jobMaxAttempts,
    jobBackoffBaseMs: defaults.jobBackoffBaseMs,
    jobBackoffMaxMs: defaults.jobBackoffMaxMs,
    paymentRetryBaseMs: defaults.paymentRetryBaseMs,
    paymentRetryMaxMs: defaults.paymentRetryMaxMs,
    paymentRetryMaxAttempts: defaults.paymentRetryMaxAttempts,
    paymentExhaustionAction: defaults.paymentExhaustionAction,
    pastDueExpiryDays: defaults.pastDueExpiryDays,
    workerStaleMs: defaults.workerStaleMs,
    ...overrides,
  };
}

async function listNotifications(
  test: TestApp,
  organizationId: string,
): Promise<NotificationRecord[]> {
  const result = await test.automationStore.listNotifications(organizationId, {
    status: "ALL",
    type: "ALL",
    page: 1,
    pageSize: 100,
  });

  return result.items;
}

function notificationInput(
  organizationId: string,
  overrides: Partial<Parameters<NotificationService["enqueue"]>[0]> = {},
): Parameters<NotificationService["enqueue"]>[0] {
  return {
    organizationId,
    customerId: null,
    subscriptionId: null,
    invoiceId: null,
    type: "PAYMENT_SUCCEEDED",
    dedupeKey: `test:${randomUUID()}`,
    recipientEmail: "billing@acme.test",
    data: {
      organizationName: automationOrganizationName(organizationId),
      customerName: "Acme Industries",
      invoiceNumber: "INV-0001",
      amountMinor: 5_800,
      currency: "USD",
    },
    ...overrides,
  };
}

describe("automation scheduling", () => {
  it("schedules a renewal reminder and recurring invoice once per period", async () => {
    const test = createTestApp();
    const organizationId = randomUUID();
    const subscription = await createAutomationSubscription(
      test,
      organizationId,
    );
    seedAutomationSubscription(test, subscription);
    const now = new Date();

    const first = await test.automationService.runSweep(now);

    expect(first.organizations).toBe(1);
    expect(first.jobsCreated).toBe(2);
    expect(first.jobsDispatched).toBe(0);

    const jobs = await listAutomationJobs(test, organizationId);
    const reminder = jobs.find((job) => job.type === "RENEWAL_REMINDER");
    const recurring = jobs.find((job) => job.type === "RECURRING_INVOICE");

    expect(reminder).toBeDefined();
    expect(reminder?.runAt.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(recurring).toBeDefined();
    expect(recurring?.runAt.toISOString()).toBe(
      subscription.currentPeriodEnd.toISOString(),
    );

    const second = await test.automationService.runSweep(now);

    expect(second.jobsCreated).toBe(0);
    expect(await listAutomationJobs(test, organizationId)).toHaveLength(2);
  });

  it("schedules trial reminders and activation relative to the trial end", async () => {
    const test = createTestApp();
    const organizationId = randomUUID();
    const trialEndsAt = new Date(Date.now() + 2 * DAY_MS);
    const subscription = await createAutomationSubscription(
      test,
      organizationId,
      {
        status: "TRIALING",
        trialDays: 14,
        trialEndsAt,
        currentPeriodEnd: new Date(Date.now() + 10 * DAY_MS),
      },
    );
    seedAutomationSubscription(test, subscription);
    const now = new Date();

    await test.automationService.runSweep(now);

    const jobs = await listAutomationJobs(test, organizationId);
    const reminder = jobs.find((job) => job.type === "TRIAL_ENDING_REMINDER");
    const activation = jobs.find((job) => job.type === "TRIAL_ACTIVATION");

    expect(reminder).toBeDefined();
    expect(reminder?.runAt.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(activation).toBeDefined();
    expect(activation?.runAt.toISOString()).toBe(trialEndsAt.toISOString());
  });

  it("does not schedule a renewal reminder when cancellation is scheduled", async () => {
    const test = createTestApp();
    const organizationId = randomUUID();
    const periodEnd = new Date(Date.now() - 60_000);
    const created = await createAutomationSubscription(test, organizationId, {
      currentPeriodStart: new Date(periodEnd.getTime() - 30 * DAY_MS),
      currentPeriodEnd: periodEnd,
    });
    const subscription = await test.subscriptionStore.applyLifecycleChange(
      organizationId,
      created.id,
      {
        expectedStatus: created.status,
        expectedPeriodEnd: created.currentPeriodEnd,
        status: "ACTIVE",
        currentPeriodStart: created.currentPeriodStart,
        currentPeriodEnd: created.currentPeriodEnd,
        cancelAtPeriodEnd: true,
        canceledAt: null,
        pausedAt: null,
        endedAt: null,
        activity: {
          type: "CANCEL_SCHEDULED",
          message: "Scheduled cancellation in an automation test.",
          actorId: null,
          actorName: "Automation Test",
        },
      },
    );
    seedAutomationSubscription(test, subscription);

    const summary = await test.automationService.runSweep(new Date());
    const jobs = await listAutomationJobs(test, organizationId);

    expect(summary.jobsCreated).toBe(1);
    expect(jobs.map((job) => job.type)).toEqual(["CANCEL_AT_PERIOD_END"]);
  });

  it("records status sync work for past-due subscriptions", async () => {
    const test = createTestApp();
    const organizationId = randomUUID();
    const subscription = await createAutomationSubscription(
      test,
      organizationId,
      {
        status: "PAST_DUE",
        currentPeriodEnd: new Date(Date.now() - 2 * DAY_MS),
      },
    );
    seedAutomationSubscription(test, subscription);

    const summary = await test.automationService.runSweep(new Date());
    const job = await findAutomationJob(test, organizationId, "STATUS_SYNC");

    expect(summary.jobsCreated).toBe(1);
    expect(job).toBeDefined();
  });
});

describe("automation job execution", () => {
  it("activates an ended trial, generates one invoice, and skips a duplicate delivery", async () => {
    const test = createTestApp();
    const organizationId = randomUUID();
    const subscription = await createAutomationSubscription(
      test,
      organizationId,
      {
        status: "TRIALING",
        trialDays: 14,
        trialEndsAt: new Date(Date.now() - 60_000),
      },
    );
    seedAutomationSubscription(test, subscription);

    await test.automationService.runSweep(new Date());
    const job = await findAutomationJob(
      test,
      organizationId,
      "TRIAL_ACTIVATION",
    );

    expect(job).toBeDefined();
    expect(
      await test.automationService.processJob(job!.id, "worker-trial"),
    ).toBe("succeeded");

    const updated = await test.subscriptionStore.findById(
      organizationId,
      subscription.id,
    );
    const invoices = await test.invoiceStore.listBySubscription(
      organizationId,
      subscription.id,
    );
    const notifications = await listNotifications(test, organizationId);

    expect(updated?.status).toBe("ACTIVE");
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.periodStart?.toISOString()).toBe(
      subscription.currentPeriodStart.toISOString(),
    );
    expect(invoices[0]?.periodEnd?.toISOString()).toBe(
      subscription.currentPeriodEnd.toISOString(),
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe("INVOICE_GENERATED");
    expect(
      await test.automationService.processJob(job!.id, "worker-duplicate"),
    ).toBe("skipped");
    expect(
      await test.invoiceStore.listBySubscription(
        organizationId,
        subscription.id,
      ),
    ).toHaveLength(1);
  });

  it("renews an active subscription, advances the period, and deduplicates the invoice", async () => {
    const test = createTestApp();
    const organizationId = randomUUID();
    const periodEnd = new Date(Date.now() - 60_000);
    const subscription = await createAutomationSubscription(
      test,
      organizationId,
      {
        currentPeriodStart: new Date(periodEnd.getTime() - 30 * DAY_MS),
        currentPeriodEnd: periodEnd,
      },
    );
    seedAutomationSubscription(test, subscription);

    await test.automationService.runSweep(new Date());
    const job = await findAutomationJob(
      test,
      organizationId,
      "RECURRING_INVOICE",
    );

    expect(job).toBeDefined();
    expect(
      await test.automationService.processJob(job!.id, "worker-recurring"),
    ).toBe("succeeded");

    const nextEnd = addBillingInterval(periodEnd, subscription.interval);
    const updated = await test.subscriptionStore.findById(
      organizationId,
      subscription.id,
    );
    const invoices = await test.invoiceStore.listBySubscription(
      organizationId,
      subscription.id,
    );

    expect(updated?.status).toBe("ACTIVE");
    expect(updated?.currentPeriodStart.toISOString()).toBe(
      periodEnd.toISOString(),
    );
    expect(updated?.currentPeriodEnd.toISOString()).toBe(
      nextEnd.toISOString(),
    );
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.periodStart?.toISOString()).toBe(
      periodEnd.toISOString(),
    );
    expect(invoices[0]?.periodEnd?.toISOString()).toBe(nextEnd.toISOString());
    expect(invoices[0]?.status).toBe("DRAFT");
    expect(await listNotifications(test, organizationId)).toHaveLength(1);

    expect(
      await test.automationService.processJob(job!.id, "worker-repeat"),
    ).toBe("skipped");
    expect(
      await test.invoiceStore.listBySubscription(
        organizationId,
        subscription.id,
      ),
    ).toHaveLength(1);
    expect(await listNotifications(test, organizationId)).toHaveLength(1);
  });

  it("executes a scheduled cancellation at period end", async () => {
    const test = createTestApp();
    const organizationId = randomUUID();
    const periodEnd = new Date(Date.now() - 60_000);
    const created = await createAutomationSubscription(test, organizationId, {
      currentPeriodStart: new Date(periodEnd.getTime() - 30 * DAY_MS),
      currentPeriodEnd: periodEnd,
    });
    const subscription = await test.subscriptionStore.applyLifecycleChange(
      organizationId,
      created.id,
      {
        expectedStatus: created.status,
        expectedPeriodEnd: created.currentPeriodEnd,
        status: "ACTIVE",
        currentPeriodStart: created.currentPeriodStart,
        currentPeriodEnd: created.currentPeriodEnd,
        cancelAtPeriodEnd: true,
        canceledAt: null,
        pausedAt: null,
        endedAt: null,
        activity: {
          type: "CANCEL_SCHEDULED",
          message: "Scheduled cancellation in an automation test.",
          actorId: null,
          actorName: "Automation Test",
        },
      },
    );
    seedAutomationSubscription(test, subscription);

    await test.automationService.runSweep(new Date());
    const job = await findAutomationJob(
      test,
      organizationId,
      "CANCEL_AT_PERIOD_END",
    );

    expect(job).toBeDefined();
    expect(
      await test.automationService.processJob(job!.id, "worker-cancel"),
    ).toBe("succeeded");

    const updated = await test.subscriptionStore.findById(
      organizationId,
      subscription.id,
    );
    const notifications = await listNotifications(test, organizationId);

    expect(updated?.status).toBe("CANCELED");
    expect(updated?.cancelAtPeriodEnd).toBe(false);
    expect(updated?.endedAt).not.toBeNull();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe("SUBSCRIPTION_CANCELED");
  });

  it("reactivates a settled past-due subscription through status sync", async () => {
    const test = createTestApp();
    const organizationId = randomUUID();
    const subscription = await createAutomationSubscription(
      test,
      organizationId,
      {
        status: "PAST_DUE",
        currentPeriodEnd: new Date(Date.now() - 2 * DAY_MS),
      },
    );
    seedAutomationSubscription(test, subscription);

    await test.automationService.runSweep(new Date());
    const job = await findAutomationJob(test, organizationId, "STATUS_SYNC");

    expect(job).toBeDefined();
    expect(
      await test.automationService.processJob(job!.id, "worker-sync"),
    ).toBe("succeeded");

    const updated = await test.subscriptionStore.findById(
      organizationId,
      subscription.id,
    );

    expect(updated?.status).toBe("ACTIVE");
  });

  it("expires a past-due subscription with an outstanding balance after the grace period", async () => {
    const test = createTestApp();
    const organizationId = randomUUID();
    const subscription = await createAutomationSubscription(
      test,
      organizationId,
      {
        status: "PAST_DUE",
        currentPeriodStart: new Date(Date.now() - 70 * DAY_MS),
        currentPeriodEnd: new Date(Date.now() - 40 * DAY_MS),
      },
    );
    await createAutomationInvoice(test, subscription);
    seedAutomationSubscription(test, subscription);

    await test.automationService.runSweep(new Date());
    const job = await findAutomationJob(
      test,
      organizationId,
      "SUBSCRIPTION_EXPIRATION",
    );

    expect(job).toBeDefined();
    expect(
      await test.automationService.processJob(job!.id, "worker-expire"),
    ).toBe("succeeded");

    const updated = await test.subscriptionStore.findById(
      organizationId,
      subscription.id,
    );
    const notifications = await listNotifications(test, organizationId);

    expect(updated?.status).toBe("EXPIRED");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe("SUBSCRIPTION_CANCELED");
  });

  it("claims a queued job exactly once under concurrent processing", async () => {
    const test = createTestApp();
    const organizationId = randomUUID();
    const periodEnd = new Date(Date.now() - 60_000);
    const subscription = await createAutomationSubscription(
      test,
      organizationId,
      {
        currentPeriodStart: new Date(periodEnd.getTime() - 30 * DAY_MS),
        currentPeriodEnd: periodEnd,
      },
    );
    seedAutomationSubscription(test, subscription);
    await test.automationService.runSweep(new Date());

    const job = await findAutomationJob(
      test,
      organizationId,
      "RECURRING_INVOICE",
    );

    expect(job).toBeDefined();
    await test.automationStore.markJobQueued(
      job!.id,
      job!.dispatchGeneration,
      new Date(),
    );

    const outcomes = await Promise.all([
      test.automationService.processJob(job!.id, "worker-a"),
      test.automationService.processJob(job!.id, "worker-b"),
    ]);

    expect([...outcomes].sort()).toEqual(["skipped", "succeeded"]);

    const stored = await test.automationStore.findJob(
      organizationId,
      job!.id,
    );
    const invoices = await test.invoiceStore.listBySubscription(
      organizationId,
      subscription.id,
    );

    expect(stored?.status).toBe("SUCCEEDED");
    expect(stored?.attempts).toBe(1);
    expect(invoices).toHaveLength(1);
  });
});

describe("automation dispatch", () => {
  it("dispatches an outbox job to the queue and processes the queued delivery", async () => {
    const dispatched: string[] = [];
    const test = createTestApp({
      automationDispatcher: {
        async dispatchJob(job: Parameters<
          NonNullable<
            Parameters<typeof createAutomationService>[0]["dispatcher"]
          >["dispatchJob"]
        >[0]) {
          await test.automationStore.markJobQueued(
            job.id,
            job.dispatchGeneration,
            new Date(),
          );
          dispatched.push(job.id);
          return true;
        },
      },
    });
    const organizationId = randomUUID();
    const subscription = await createAutomationSubscription(
      test,
      organizationId,
    );
    seedAutomationSubscription(test, subscription);

    const summary = await test.automationService.runSweep(new Date());
    const reminder = await findAutomationJob(
      test,
      organizationId,
      "RENEWAL_REMINDER",
    );

    expect(summary.jobsDispatched).toBe(1);
    expect(dispatched).toEqual([reminder?.id]);
    expect(reminder?.status).toBe("QUEUED");
    expect(
      await test.automationService.processJob(reminder!.id, "worker-dispatch"),
    ).toBe("succeeded");
    expect(await listNotifications(test, organizationId)).toHaveLength(1);
  });
});

describe("automation retries and recovery", () => {
  it("retries a failing job with bounded backoff and dead-letters at the limit", async () => {
    vi.useFakeTimers();
    const start = new Date("2026-07-01T12:00:00.000Z");
    vi.setSystemTime(start);

    try {
      const test = createTestApp();
      const failingNotifications = {
        async enqueue() {
          throw new Error("The mailer is offline.");
        },
        async dispatchPending() {
          return 0;
        },
        async deliver() {
          return "skipped";
        },
        async retry() {
          return null;
        },
      } as unknown as NotificationService;
      const service = createAutomationService({
        store: test.automationStore,
        candidates: test.automationCandidates,
        subscriptions: test.subscriptionStore,
        invoices: test.invoiceStore,
        customers: test.customerStore,
        notifications: failingNotifications,
        config: automationConfig({
          jobMaxAttempts: 2,
          jobBackoffBaseMs: 10_000,
          jobBackoffMaxMs: 10_000,
        }),
      });
      const organizationId = randomUUID();
      const subscription = await createAutomationSubscription(
        test,
        organizationId,
      );
      seedAutomationSubscription(test, subscription);
      await service.runSweep(start);

      const reminder = await findAutomationJob(
        test,
        organizationId,
        "RENEWAL_REMINDER",
      );

      expect(reminder).toBeDefined();
      expect(await service.processJob(reminder!.id, "worker-1")).toBe(
        "failed",
      );

      const failed = await test.automationStore.findJob(
        organizationId,
        reminder!.id,
      );

      expect(failed?.status).toBe("FAILED");
      expect(failed?.attempts).toBe(1);
      expect(failed?.lastError).toContain("mailer is offline");
      expect(failed?.runAt.getTime()).toBe(start.getTime() + 10_000);

      vi.setSystemTime(new Date(start.getTime() + 10_001));

      expect(await service.processJob(reminder!.id, "worker-2")).toBe(
        "failed",
      );

      const deadLetter = await test.automationStore.findJob(
        organizationId,
        reminder!.id,
      );

      expect(deadLetter?.status).toBe("DEAD_LETTER");
      expect(deadLetter?.attempts).toBe(2);
      expect(deadLetter?.finishedAt).not.toBeNull();
      expect(await service.processJob(reminder!.id, "worker-3")).toBe(
        "skipped",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers stale running and queued jobs", async () => {
    const test = createTestApp();
    const organizationId = randomUUID();
    const now = new Date();
    const running = await test.automationStore.createJob({
      organizationId,
      type: "STATUS_SYNC",
      queue: "BILLING",
      idempotencyKey: `stale-running:${randomUUID()}`,
      targetType: "SUBSCRIPTION",
      targetId: null,
      runAt: new Date(now.getTime() - 600_000),
      maxAttempts: 3,
    });
    const queued = await test.automationStore.createJob({
      organizationId,
      type: "STATUS_SYNC",
      queue: "BILLING",
      idempotencyKey: `stale-queued:${randomUUID()}`,
      targetType: "SUBSCRIPTION",
      targetId: null,
      runAt: new Date(now.getTime() - 600_000),
      maxAttempts: 3,
    });

    await test.automationStore.claimJob(
      running.job.id,
      "stopped-worker",
      new Date(now.getTime() - 400_000),
    );
    await test.automationStore.markJobQueued(
      queued.job.id,
      queued.job.dispatchGeneration,
      new Date(now.getTime() - 400_000),
    );

    const summary = await test.automationService.runSweep(now);
    const recoveredRunning = await test.automationStore.findJobById(
      running.job.id,
    );
    const recoveredQueued = await test.automationStore.findJobById(
      queued.job.id,
    );

    expect(summary.staleJobsRecovered).toBe(2);
    expect(recoveredRunning?.status).toBe("PENDING");
    expect(recoveredRunning?.lastError).toContain("worker stopped");
    expect(recoveredQueued?.status).toBe("PENDING");
  });

  it("keeps job records scoped to their organization", async () => {
    const test = createTestApp();
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const jobA = await test.automationStore.createJob({
      organizationId: organizationA,
      type: "STATUS_SYNC",
      queue: "BILLING",
      idempotencyKey: `scope-a:${randomUUID()}`,
      targetType: "SUBSCRIPTION",
      targetId: null,
      runAt: new Date(),
      maxAttempts: 1,
    });
    const jobB = await test.automationStore.createJob({
      organizationId: organizationB,
      type: "STATUS_SYNC",
      queue: "BILLING",
      idempotencyKey: `scope-b:${randomUUID()}`,
      targetType: "SUBSCRIPTION",
      targetId: null,
      runAt: new Date(),
      maxAttempts: 1,
    });

    await test.automationStore.claimJob(jobB.job.id, "worker", new Date());
    await test.automationStore.failJob(
      jobB.job.id,
      { lastError: "Synthetic failure.", retryAt: null },
      new Date(),
    );

    expect(await listAutomationJobs(test, organizationA)).toHaveLength(1);
    expect(
      await test.automationStore.findJob(organizationA, jobB.job.id),
    ).toBeNull();
    expect(
      await test.automationService.retryJob(organizationA, jobB.job.id),
    ).toBeNull();
    expect(
      await test.automationService.retryJob(
        organizationB,
        jobA.job.id,
      ),
    ).toBeNull();
  });
});

describe("payment recovery", () => {
  it("sends recovery reminders, then marks the subscription past due without charging", async () => {
    const test = createTestApp({
      automationConfig: {
        paymentRetryMaxAttempts: 2,
        paymentRetryBaseMs: 0,
        paymentRetryMaxMs: 0,
      },
    });
    const organizationId = randomUUID();
    const subscription = await createAutomationSubscription(
      test,
      organizationId,
    );
    const invoice = await createAutomationInvoice(test, subscription);
    const payment = await createFailedGatewayPayment(
      test,
      subscription,
      invoice,
    );
    seedAutomationSubscription(test, subscription);
    seedFailedPayment(test, subscription, invoice, payment);

    await test.automationService.runSweep(new Date());
    const first = (await listAutomationJobs(test, organizationId)).find(
      (job) => job.type === "PAYMENT_RECOVERY",
    );

    expect(first).toBeDefined();
    expect(
      await test.automationService.processJob(first!.id, "worker-payment-1"),
    ).toBe("succeeded");

    let notifications = (await listNotifications(test, organizationId)).filter(
      (notification) => notification.type === "PAYMENT_FAILED",
    );

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.status).toBe("PENDING");
    expect(notifications[0]?.attempts).toBe(0);

    await test.automationService.runSweep(new Date());
    const second = (await listAutomationJobs(test, organizationId)).find(
      (job) => job.type === "PAYMENT_RECOVERY" && job.status === "PENDING",
    );

    expect(second).toBeDefined();
    expect(
      await test.automationService.processJob(second!.id, "worker-payment-2"),
    ).toBe("succeeded");

    const updated = await test.subscriptionStore.findById(
      organizationId,
      subscription.id,
    );
    const refreshedPayment = await test.invoiceStore.findPaymentById(
      organizationId,
      payment.id,
    );
    const refreshedInvoice = await test.invoiceStore.findById(
      organizationId,
      invoice.id,
    );

    notifications = (await listNotifications(test, organizationId)).filter(
      (notification) => notification.type === "PAYMENT_FAILED",
    );

    expect(updated?.status).toBe("PAST_DUE");
    expect(notifications).toHaveLength(2);
    expect(refreshedPayment?.status).toBe("FAILED");
    expect(refreshedInvoice?.payments).toHaveLength(1);
  });

  it("cancels the subscription when configured after recovery exhaustion", async () => {
    const test = createTestApp({
      automationConfig: {
        paymentRetryMaxAttempts: 1,
        paymentExhaustionAction: "CANCEL",
      },
    });
    const organizationId = randomUUID();
    const subscription = await createAutomationSubscription(
      test,
      organizationId,
    );
    const invoice = await createAutomationInvoice(test, subscription);
    const payment = await createFailedGatewayPayment(
      test,
      subscription,
      invoice,
    );
    seedAutomationSubscription(test, subscription);
    seedFailedPayment(test, subscription, invoice, payment);

    await test.automationService.runSweep(new Date());
    const job = (await listAutomationJobs(test, organizationId)).find(
      (candidate) => candidate.type === "PAYMENT_RECOVERY",
    );

    expect(job).toBeDefined();
    expect(
      await test.automationService.processJob(job!.id, "worker-payment"),
    ).toBe("succeeded");

    const updated = await test.subscriptionStore.findById(
      organizationId,
      subscription.id,
    );
    const notifications = await listNotifications(test, organizationId);

    expect(updated?.status).toBe("CANCELED");
    expect(
      notifications.filter((notification) => notification.type === "PAYMENT_FAILED"),
    ).toHaveLength(1);
    expect(
      notifications.filter(
        (notification) => notification.type === "SUBSCRIPTION_CANCELED",
      ),
    ).toHaveLength(1);
  });
});

describe("notification delivery", () => {
  it("deduplicates identical notification intent", async () => {
    const test = createTestApp();
    const organizationId = randomUUID();
    const input = notificationInput(organizationId);

    const first = await test.notificationService.enqueue(input);
    const second = await test.notificationService.enqueue(input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.notification.id).toBe(first.notification.id);
    expect(await listNotifications(test, organizationId)).toHaveLength(1);
  });

  it("retries a failed delivery without duplicating a sent notification", async () => {
    let sends = 0;
    const provider: EmailProvider = {
      name: "flaky",
      async send() {
        sends += 1;

        if (sends === 1) {
          throw new Error("SMTP is temporarily unavailable.");
        }

        return {
          providerName: "flaky",
          providerMessageId: `message-${sends}`,
        };
      },
    };
    const test = createTestApp({ emailProvider: provider });
    const organizationId = randomUUID();
    const enqueued = await test.notificationService.enqueue(
      notificationInput(organizationId),
    );

    expect(
      await test.notificationService.deliver(enqueued.notification.id),
    ).toBe("failed");

    const failed = await test.automationStore.findNotification(
      organizationId,
      enqueued.notification.id,
    );

    expect(failed?.status).toBe("FAILED");
    expect(failed?.nextAttemptAt).not.toBeNull();

    expect(
      await test.notificationService.deliver(enqueued.notification.id),
    ).toBe("skipped");

    await test.notificationService.retry(
      organizationId,
      enqueued.notification.id,
      new Date(),
    );

    expect(
      await test.notificationService.deliver(enqueued.notification.id),
    ).toBe("sent");

    const sent = await test.automationStore.findNotification(
      organizationId,
      enqueued.notification.id,
    );

    expect(sent?.status).toBe("SENT");
    expect(sent?.providerName).toBe("flaky");
    expect(sent?.providerMessageId).toBe("message-2");
    expect(sends).toBe(2);
  });

  it("dead-letters a notification after the configured attempt limit", async () => {
    const provider: EmailProvider = {
      name: "down",
      async send() {
        throw new Error("The provider rejected the message.");
      },
    };
    const test = createTestApp();
    const organizationId = randomUUID();
    const service = createNotificationService({
      store: test.automationStore,
      provider,
      from: "Subscript Test <test@subscript.local>",
      maxAttempts: 1,
      retryBaseMs: 1_000,
      retryMaxMs: 1_000,
    });
    const enqueued = await service.enqueue(
      notificationInput(organizationId, { recipientEmail: "billing@acme.test" }),
    );

    expect(await service.deliver(enqueued.notification.id)).toBe(
      "dead-lettered",
    );

    const stored = await test.automationStore.findNotification(
      organizationId,
      enqueued.notification.id,
    );

    expect(stored?.status).toBe("DEAD_LETTER");
    expect(stored?.lastError).toContain("provider rejected");
  });

  it("skips an invalid recipient without calling the provider", async () => {
    let sends = 0;
    const provider: EmailProvider = {
      name: "counting",
      async send() {
        sends += 1;
        return { providerName: "counting", providerMessageId: "unexpected" };
      },
    };
    const test = createTestApp({ emailProvider: provider });
    const organizationId = randomUUID();
    const enqueued = await test.notificationService.enqueue(
      notificationInput(organizationId, { recipientEmail: "not-an-email" }),
    );

    expect(
      await test.notificationService.deliver(enqueued.notification.id),
    ).toBe("skipped");

    const stored = await test.automationStore.findNotification(
      organizationId,
      enqueued.notification.id,
    );

    expect(stored?.status).toBe("SKIPPED");
    expect(sends).toBe(0);
  });

  it("keeps notification records scoped to their organization", async () => {
    const test = createTestApp();
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const notification = await test.notificationService.enqueue(
      notificationInput(organizationB),
    );

    expect(
      await test.automationStore.findNotification(
        organizationA,
        notification.notification.id,
      ),
    ).toBeNull();
    expect(
      await listNotifications(test, organizationA),
    ).toHaveLength(0);
    expect(
      await test.notificationService.retry(
        organizationA,
        notification.notification.id,
        new Date(),
      ),
    ).toBeNull();
  });
});

describe("automation backoff", () => {
  it("grows exponentially and stops at the configured ceiling", () => {
    expect(boundedExponentialDelay(1, 1_000, 10_000)).toBe(1_000);
    expect(boundedExponentialDelay(2, 1_000, 10_000)).toBe(2_000);
    expect(boundedExponentialDelay(3, 1_000, 10_000)).toBe(4_000);
    expect(boundedExponentialDelay(10, 1_000, 10_000)).toBe(10_000);
    expect(boundedExponentialDelay(10_000, 1_000, 10_000)).toBe(10_000);
  });
});
