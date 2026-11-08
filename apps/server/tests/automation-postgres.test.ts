import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createPrismaAutomationStore } from "../src/automation/store/prisma.js";
import type {
  CreateAutomationJobInput,
  CreateNotificationInput,
} from "../src/automation/types.js";
import { createPrismaClient } from "../src/db/prisma.js";

/**
 * Real-PostgreSQL checks for the durable outbox paths that the in-memory store
 * cannot prove: unique idempotency under concurrency, atomic claims, retry
 * generations and stale-worker recovery. Enabled only when TEST_DATABASE_URL
 * points at a disposable database.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("automation PostgreSQL store", () => {
  const prisma = createPrismaClient(databaseUrl ?? "");
  const store = createPrismaAutomationStore(prisma);
  const organizationIds: string[] = [];

  afterAll(async () => {
    for (const organizationId of organizationIds) {
      await prisma.notification.deleteMany({ where: { organizationId } });
      await prisma.automationJob.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }

    await prisma.$disconnect();
  });

  async function createOrganization(name: string): Promise<string> {
    const organizationId = randomUUID();

    await prisma.organization.create({
      data: {
        id: organizationId,
        name,
        slug: `automation-${organizationId}`,
        defaultCurrency: "USD",
      },
    });
    organizationIds.push(organizationId);

    return organizationId;
  }

  function jobInput(
    organizationId: string,
    overrides: Partial<CreateAutomationJobInput> = {},
  ): CreateAutomationJobInput {
    return {
      organizationId,
      type: "STATUS_SYNC",
      queue: "BILLING",
      idempotencyKey: `postgres:${randomUUID()}`,
      targetType: "SUBSCRIPTION",
      targetId: null,
      runAt: new Date(Date.now() - 1_000),
      maxAttempts: 3,
      ...overrides,
    };
  }

  function notificationInput(
    organizationId: string,
    overrides: Partial<CreateNotificationInput> = {},
  ): CreateNotificationInput {
    return {
      organizationId,
      customerId: null,
      subscriptionId: null,
      invoiceId: null,
      type: "PAYMENT_SUCCEEDED",
      dedupeKey: `postgres:${randomUUID()}`,
      recipientEmail: "billing@acme.test",
      subject: "Payment received",
      bodyText: "A payment was received.",
      bodyHtml: "<p>A payment was received.</p>",
      maxAttempts: 3,
      ...overrides,
    };
  }

  it("creates one job for concurrent identical idempotency keys", async () => {
    const organizationId = await createOrganization("Concurrent Jobs");
    const input = jobInput(organizationId);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => store.createJob(input)),
    );

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.job.id)).size).toBe(1);
    expect(
      await prisma.automationJob.count({ where: { organizationId } }),
    ).toBe(1);
  });

  it("claims a queued job exactly once under concurrent workers", async () => {
    const organizationId = await createOrganization("Concurrent Claims");
    const created = await store.createJob(jobInput(organizationId));
    const queuedAt = new Date();

    await store.markJobQueued(
      created.job.id,
      created.job.dispatchGeneration,
      queuedAt,
    );

    const claims = await Promise.all(
      Array.from({ length: 5 }, (_value, index) =>
        store.claimJob(created.job.id, `worker-${index}`, new Date()),
      ),
    );
    const winners = claims.filter((claim) => claim !== null);

    expect(winners).toHaveLength(1);
    expect(winners[0]?.status).toBe("RUNNING");
    expect(winners[0]?.attempts).toBe(1);

    const persisted = await store.findJobById(created.job.id);

    expect(persisted?.status).toBe("RUNNING");
    expect(persisted?.attempts).toBe(1);

    await store.completeJob(created.job.id, "Claimed once.", new Date());
    expect(
      await store.claimJob(created.job.id, "worker-late", new Date()),
    ).toBeNull();

    const completed = await store.findJobById(created.job.id);

    expect(completed?.status).toBe("SUCCEEDED");
    expect(completed?.resultSummary).toBe("Claimed once.");
  });

  it("requires the current dispatch generation after a manual retry", async () => {
    const organizationId = await createOrganization("Retry Generation");
    const created = await store.createJob(jobInput(organizationId));
    const now = new Date();

    await store.claimJob(created.job.id, "worker-failed", now);
    await store.failJob(
      created.job.id,
      { lastError: "Synthetic failure.", retryAt: null },
      now,
    );

    const failed = await store.findJobById(created.job.id);

    expect(failed?.status).toBe("DEAD_LETTER");

    const retried = await store.retryJob(organizationId, created.job.id, now);

    expect(retried?.status).toBe("PENDING");
    expect(retried?.attempts).toBe(0);
    expect(retried?.dispatchGeneration).toBe(
      (failed?.dispatchGeneration ?? 0) + 1,
    );

    await store.markJobQueued(
      created.job.id,
      failed?.dispatchGeneration ?? 0,
      now,
    );
    expect((await store.findJobById(created.job.id))?.status).toBe("PENDING");

    await store.markJobQueued(
      created.job.id,
      retried?.dispatchGeneration ?? 0,
      now,
    );
    expect((await store.findJobById(created.job.id))?.status).toBe("QUEUED");

    const claimed = await store.claimJob(
      created.job.id,
      "worker-retry",
      new Date(),
    );

    expect(claimed).not.toBeNull();
    expect(claimed?.attempts).toBe(1);
  });

  it("creates and delivers one notification for concurrent duplicate intent", async () => {
    const organizationId = await createOrganization("Notification Dedupe");
    const input = notificationInput(organizationId);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => store.createNotification(input)),
    );

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(
      new Set(results.map((result) => result.notification.id)).size,
    ).toBe(1);

    const notificationId = results[0]?.notification.id;
    const claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        store.claimNotification(notificationId ?? "", new Date()),
      ),
    );
    const winners = claims.filter((claim) => claim !== null);

    expect(winners).toHaveLength(1);
    expect(winners[0]?.status).toBe("SENDING");
    expect(winners[0]?.attempts).toBe(1);

    await store.completeNotification(
      notificationId ?? "",
      "test",
      "message-1",
      new Date(),
    );

    const sent = await store.findNotificationById(notificationId ?? "");

    expect(sent?.status).toBe("SENT");
    expect(sent?.providerMessageId).toBe("message-1");
    expect(
      await store.claimNotification(notificationId ?? "", new Date()),
    ).toBeNull();
  });

  it("recovers stale running and queued work across organizations", async () => {
    const organizationA = await createOrganization("Stale A");
    const organizationB = await createOrganization("Stale B");
    const now = new Date();
    const running = await store.createJob(jobInput(organizationA));
    const queued = await store.createJob(jobInput(organizationA));
    const other = await store.createJob(jobInput(organizationB));

    await store.claimJob(running.job.id, "stopped-worker", now);
    await prisma.automationJob.update({
      where: { id: running.job.id },
      data: {
        lockedAt: new Date(now.getTime() - 120_000),
        updatedAt: new Date(now.getTime() - 120_000),
      },
    });
    await store.markJobQueued(
      queued.job.id,
      queued.job.dispatchGeneration,
      new Date(now.getTime() - 120_000),
    );

    const recovered = await store.recoverStaleJobs(
      new Date(now.getTime() - 60_000),
      new Date(now.getTime() - 60_000),
      now,
    );

    expect(recovered).toEqual({ running: 1, queued: 1 });
    expect((await store.findJobById(running.job.id))?.status).toBe("PENDING");
    expect((await store.findJobById(queued.job.id))?.status).toBe("PENDING");
    expect((await store.findJobById(other.job.id))?.status).toBe("PENDING");

    expect(await store.listJobs(organizationA, {
      status: "ALL",
      type: "ALL",
      page: 1,
      pageSize: 100,
    })).toMatchObject({ total: 2 });
    expect(
      await store.findJob(organizationA, other.job.id),
    ).toBeNull();
    expect(
      await store.retryJob(organizationA, other.job.id, now),
    ).toBeNull();

    const countsA = await store.countJobs(organizationA);

    expect(countsA.pending).toBe(2);
  });

  it("recovers a stale notification delivery", async () => {
    const organizationId = await createOrganization("Stale Notifications");
    const created = await store.createNotification(
      notificationInput(organizationId),
    );
    const now = new Date();

    await store.claimNotification(
      created.notification.id,
      new Date(now.getTime() - 120_000),
    );

    const recovered = await store.recoverStaleNotifications(
      new Date(now.getTime() - 60_000),
      new Date(now.getTime() - 60_000),
      now,
    );

    expect(recovered.sending).toBe(1);

    const failed = await store.findNotificationById(created.notification.id);

    expect(failed?.status).toBe("FAILED");
    expect(failed?.lastError).toContain("worker stopped");
    expect(failed?.nextAttemptAt?.toISOString()).toBe(now.toISOString());
  });
});
